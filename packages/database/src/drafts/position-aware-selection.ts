import {
  computeStrategyPositionPenalty,
  isCandidateOnesieEligible,
  STARTING_LINEUP_TOTAL,
  wouldSelectionPreserveLineupFeasibility,
  type BotStrategy,
} from "@fdm/shared";
import type { Prisma, ScoringFormat } from "../generated/prisma/client.js";
import { getPositionalAdpRank } from "./positional-adp-rank.js";

// Phase 5.5/5.6: the BOT-only counterpart to selectBestAvailablePlayerId
// (player-selection.ts). Deliberately a *separate* function rather than a
// modification of that one: human timer-expiry autopick
// (processExpiredDraftTurn) keeps calling selectBestAvailablePlayerId
// completely unchanged, so a human who misses their deadline still gets
// pure BEST_AVAILABLE, never these roster-building heuristics. Only
// processBotDraftTurn calls this function.
//
// This is deliberately module-internal, not exported from
// packages/database/src/index.ts. Unlike selectBestAvailablePlayerId
// (read-only, safe to expose), this function is an implementation detail
// of BOT turn processing specifically — processBotDraftTurn remains the
// one safe, public, high-level entry point apps/socket-server is allowed
// to call.
//
// Read-only: never writes a Pick, never touches Draft, owns no part of the
// transactional correctness boundary itself. Callers (today: only
// processBotDraftTurn) are responsible for running it inside the same
// locked transaction that will go on to call applyPick with the returned
// playerId.
//
// Eligibility is unchanged from Phase 5.2: undrafted (in this draftId),
// rostered (Player.nflTeam IS NOT NULL) players only.
//
// Frozen Phase 5.6 pipeline (see CLAUDE.md's Phase 5.6 notes once written):
//
//   1. load raw eligible candidates (undrafted, rostered)
//   2. hard onesie eligibility (K<=1, DEF<=1, QB<=2, TE<=2, elite/backup-
//      window-gated QB2/TE2) — a candidate that fails this is REMOVED from
//      the pool entirely, never merely penalized. Universal across every
//      strategy; strategy is never consulted here.
//   3. starting-lineup feasibility — a candidate is removed if selecting it
//      would leave too few remaining picks to still complete the starting
//      lineup. Bypassed entirely when rosterSize < STARTING_LINEUP_TOTAL
//      (the fixed lineup cannot mathematically fit at all — see the
//      "small-roster fallback" test coverage). If feasibility filtering
//      would otherwise remove every onesie-eligible candidate, it falls
//      back to the full onesie-eligible set rather than onesie-ineligible
//      candidates — onesie rules are never relaxed by this fallback.
//   4. strategy scoring: adjustedScore = baseValue (ADP or searchRank) +
//      strategy-specific position penalty, lower wins. Tier precedence from
//      Phase 5.2 is preserved exactly: every candidate with a usable ADP
//      for this format outranks every candidate without one.
//
// If step 1 finds raw candidates but step 2 (onesie eligibility) removes
// every one of them, this function returns null — not because the raw
// player pool is exhausted, but because no BOT-strategy-eligible candidate
// remains under the universal hard roster rules. The caller
// (processBotDraftTurn) treats this identically to true pool exhaustion
// (BotPickExhaustedError) unless/until a concrete need for a distinct
// error is shown.
export async function selectPositionAwareBotPlayerId(
  tx: Prisma.TransactionClient,
  params: {
    draftId: string;
    leagueMemberId: string;
    scoringFormat: ScoringFormat;
    rosterSize: number;
    currentPickNumber: number;
    teamCount: number;
    botStrategy: BotStrategy;
  },
): Promise<string | null> {
  const { draftId, leagueMemberId, scoringFormat, rosterSize, currentPickNumber, teamCount, botStrategy } = params;

  // Round-awareness, unchanged from 5.5: K/DEF timing and the QB/TE backup
  // window both derive from the League's own rosterSize, never a
  // hardcoded 15, so historical non-15 leagues and internal test fixtures
  // compute correctly-scaled windows with no special-casing.
  const roundNumber = Math.ceil(currentPickNumber / teamCount);
  const lateWindowStart = Math.max(1, rosterSize - 2);
  const isLateWindow = roundNumber >= lateWindowStart;

  // Roster position counts and total pick count for *this* BOT only,
  // keyed by leagueMemberId, never userId (a BOT has none). Other members'
  // Picks are never read here, so they structurally cannot affect this
  // BOT's own penalties, onesie eligibility, or feasibility math.
  const ownedPicks = await tx.pick.findMany({
    where: { draftId, leagueMemberId },
    select: { player: { select: { id: true, position: true } } },
  });
  const ownedCounts: Record<string, number> = {};
  for (const pick of ownedPicks) {
    ownedCounts[pick.player.position] = (ownedCounts[pick.player.position] ?? 0) + 1;
  }
  const remainingPicksIncludingThisOne = rosterSize - ownedPicks.length;

  // Positional ADP rank is only meaningful — and only ever computed — for
  // an owned QB/TE when the BOT owns exactly one, per the frozen design
  // ("the selector does not need to compute the rank of every candidate").
  // At most two extra queries per BOT turn, never one per candidate.
  let ownedQbPositionalRank: number | null = null;
  if (ownedCounts.QB === 1) {
    const ownedQb = ownedPicks.find((pick) => pick.player.position === "QB")!;
    ownedQbPositionalRank = await getPositionalAdpRank(tx, {
      playerId: ownedQb.player.id,
      position: "QB",
      scoringFormat,
    });
  }
  let ownedTePositionalRank: number | null = null;
  if (ownedCounts.TE === 1) {
    const ownedTe = ownedPicks.find((pick) => pick.player.position === "TE")!;
    ownedTePositionalRank = await getPositionalAdpRank(tx, {
      playerId: ownedTe.player.id,
      position: "TE",
      scoringFormat,
    });
  }

  // The full eligible candidate pool in one query, scored entirely in
  // TypeScript rather than a bounded top-N window — see Phase 5.5's
  // reasoning (still applicable; the pool has not grown).
  const candidates = await tx.player.findMany({
    where: { nflTeam: { not: null }, picks: { none: { draftId } } },
    select: {
      id: true,
      position: true,
      searchRank: true,
      adp: { where: { format: scoringFormat }, select: { adp: true } },
    },
  });

  type Candidate = { id: string; position: string; adp: number | null; searchRank: number | null };
  const rawCandidates: Candidate[] = candidates.map((candidate) => ({
    id: candidate.id,
    position: candidate.position,
    adp: candidate.adp[0]?.adp ?? null,
    searchRank: candidate.searchRank,
  }));

  // Step 2: hard onesie eligibility. Universal across every strategy — no
  // strategy parameter is passed to this function.
  const onesieEligible = rawCandidates.filter((candidate) =>
    isCandidateOnesieEligible({
      position: candidate.position,
      ownedCounts,
      ownedQbPositionalRank,
      ownedTePositionalRank,
      roundNumber,
      rosterSize,
    }),
  );

  // Step 3: starting-lineup feasibility, with the small-roster bypass and
  // the impossible-lineup fallback. Onesie-ineligible candidates are never
  // reconsidered here or below — the fallback only ever widens back to
  // `onesieEligible`, never to `rawCandidates`.
  let feasibilityPool: Candidate[];
  if (rosterSize < STARTING_LINEUP_TOTAL) {
    feasibilityPool = onesieEligible;
  } else {
    const feasible = onesieEligible.filter((candidate) =>
      wouldSelectionPreserveLineupFeasibility(ownedCounts, candidate.position, remainingPicksIncludingThisOne),
    );
    feasibilityPool = feasible.length > 0 ? feasible : onesieEligible;
  }

  type ScoredCandidate = Candidate & { penalty: number };
  const scored: ScoredCandidate[] = feasibilityPool.map((candidate) => ({
    ...candidate,
    penalty: computeStrategyPositionPenalty(botStrategy, candidate.position, ownedCounts, isLateWindow),
  }));

  scored.sort(compareCandidates);
  return scored[0]?.id ?? null;
}

type Candidate = { id: string; adp: number | null; searchRank: number | null; penalty: number };

function compareId(a: string, b: string): number {
  if (a === b) return 0;
  return a < b ? -1 : 1;
}

// Unchanged from Phase 5.5: explicit, branch-based comparator rather than
// folding null handling into a single numeric sentinel.
function compareCandidates(a: Candidate, b: Candidate): number {
  const aHasAdp = a.adp !== null;
  const bHasAdp = b.adp !== null;

  if (aHasAdp !== bHasAdp) {
    return aHasAdp ? -1 : 1;
  }

  if (aHasAdp && bHasAdp) {
    const aScore = a.adp! + a.penalty;
    const bScore = b.adp! + b.penalty;
    if (aScore !== bScore) return aScore - bScore;
    if (a.adp !== b.adp) return a.adp! - b.adp!;

    const aHasRank = a.searchRank !== null;
    const bHasRank = b.searchRank !== null;
    if (aHasRank !== bHasRank) return aHasRank ? -1 : 1;
    if (aHasRank && bHasRank && a.searchRank !== b.searchRank) {
      return a.searchRank! - b.searchRank!;
    }
    return compareId(a.id, b.id);
  }

  const aHasRank = a.searchRank !== null;
  const bHasRank = b.searchRank !== null;
  if (aHasRank !== bHasRank) return aHasRank ? -1 : 1;

  if (aHasRank && bHasRank) {
    const aScore = a.searchRank! + a.penalty;
    const bScore = b.searchRank! + b.penalty;
    if (aScore !== bScore) return aScore - bScore;
    if (a.searchRank !== b.searchRank) return a.searchRank! - b.searchRank!;
    return compareId(a.id, b.id);
  }

  if (a.penalty !== b.penalty) return a.penalty - b.penalty;
  return compareId(a.id, b.id);
}

