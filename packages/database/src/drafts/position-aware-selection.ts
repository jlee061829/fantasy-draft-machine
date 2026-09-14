import type { Prisma, ScoringFormat } from "../generated/prisma/client.js";

// Phase 5.5: the BOT-only counterpart to selectBestAvailablePlayerId
// (player-selection.ts). Deliberately a *separate* function rather than a
// modification of that one: human timer-expiry autopick
// (processExpiredDraftTurn) keeps calling selectBestAvailablePlayerId
// completely unchanged, so a human who misses their deadline still gets
// pure BEST_AVAILABLE, never these roster-building heuristics. Only
// processBotDraftTurn calls this function. See CLAUDE.md's Phase 5.5 notes
// (once written) for the full rationale; the short version: a human's
// missed deadline and a bot's own intentional pick are different events,
// and wasAutopick's existing meaning ("timer expired") shouldn't start
// silently reflecting strategy no human chose.
//
// This is deliberately module-internal, not exported from
// packages/database/src/index.ts. Unlike selectBestAvailablePlayerId (read-
// only, safe to expose), this function is an implementation detail of BOT
// turn processing specifically — processBotDraftTurn remains the one safe,
// public, high-level entry point apps/socket-server is allowed to call.
//
// Read-only, exactly like selectBestAvailablePlayerId: never writes a Pick,
// never touches Draft, owns no part of the transactional correctness
// boundary itself. Callers (today: only processBotDraftTurn) are
// responsible for running it inside the same locked transaction that will
// go on to call applyPick with the returned playerId.
//
// Eligibility is unchanged from Phase 5.2: undrafted (in this draftId),
// rostered (Player.nflTeam IS NOT NULL) players only — the same pool the
// Available Players UI and selectBestAvailablePlayerId both use. This
// milestone does not broaden or narrow that pool; it only changes *which*
// eligible candidate wins.
//
// Strategy: `adjustedScore = baseValue + positionPenalty`, lower wins.
// baseValue is the candidate's own ADP (when a non-null ADP row exists for
// the league's scoringFormat) or searchRank (fallback). positionPenalty is
// a small additive nudge based on how many Picks this specific BOT
// (leagueMemberId) already owns at that position in this draft, plus (as of
// the K/DEF timing-rule product decision below) a round-aware timing
// component for K/DEF specifically — never a hard exclusion, so a
// sufficiently large raw value gap can still overcome it. Tier precedence
// from Phase 5.2 is preserved exactly: every candidate with a usable ADP
// for this format outranks every candidate without one, regardless of
// position penalties on either side — position-awareness only reorders
// candidates *within* a tier. This is a deliberately conservative
// compatibility decision: it keeps Phase 5.2's existing "ADP beats no-ADP,
// always" guarantee intact rather than inventing a cross-tier ADP/searchRank
// unit conversion, which would itself be an unjustified magic number.
export async function selectPositionAwareBotPlayerId(
  tx: Prisma.TransactionClient,
  params: {
    draftId: string;
    leagueMemberId: string;
    scoringFormat: ScoringFormat;
    rosterSize: number;
    currentPickNumber: number;
    teamCount: number;
  },
): Promise<string | null> {
  const { draftId, leagueMemberId, scoringFormat, rosterSize, currentPickNumber, teamCount } = params;

  // Round-awareness (product decision, post-5.5): K/DEF are strongly
  // discouraged everywhere except the final 3 rounds of the *League's own*
  // rosterSize, not a hardcoded 15 — rosterSize remains fully dynamic (see
  // CLAUDE.md's rosterSize conventions), so this formula, not a literal
  // round number, is what stays correct for historical non-15 leagues and
  // internal test fixtures alike. `Math.max(1, ...)` guards a pathologically
  // small rosterSize (e.g. an internal test fixture) from producing a
  // zero/negative lateWindowStart.
  const roundNumber = Math.ceil(currentPickNumber / teamCount);
  const lateWindowStart = Math.max(1, rosterSize - 2);
  const isLateWindow = roundNumber >= lateWindowStart;

  // Roster position counts for *this* BOT only. Keyed by leagueMemberId,
  // never userId (a BOT has none) — matches the Phase 5.1
  // deriveTeamRosters/team-roster-helpers.ts convention exactly. Other
  // members' Picks are never read here, so they structurally cannot affect
  // this BOT's own position penalties.
  const ownedPicks = await tx.pick.findMany({
    where: { draftId, leagueMemberId },
    select: { player: { select: { position: true } } },
  });
  const ownedCounts: Record<string, number> = {};
  for (const pick of ownedPicks) {
    ownedCounts[pick.player.position] = (ownedCounts[pick.player.position] ?? 0) + 1;
  }

  // The full eligible candidate pool in one query, scored entirely in
  // TypeScript rather than a bounded top-N window. At most ~1,068 rostered
  // Players exist in the current seeded pool (see CLAUDE.md), and it only
  // shrinks as a draft progresses — small enough that a bounded window
  // would introduce a real correctness risk (the true best-fit candidate
  // for this BOT's needs could sit just outside an arbitrary cutoff) for no
  // performance benefit worth having.
  const candidates = await tx.player.findMany({
    where: { nflTeam: { not: null }, picks: { none: { draftId } } },
    select: {
      id: true,
      position: true,
      searchRank: true,
      adp: { where: { format: scoringFormat }, select: { adp: true } },
    },
  });

  type ScoredCandidate = {
    id: string;
    adp: number | null;
    searchRank: number | null;
    penalty: number;
  };

  const scored: ScoredCandidate[] = candidates.map((candidate) => ({
    id: candidate.id,
    adp: candidate.adp[0]?.adp ?? null,
    searchRank: candidate.searchRank,
    penalty: computePositionPenalty(
      candidate.position,
      ownedCounts[candidate.position] ?? 0,
      isLateWindow,
    ),
  }));

  scored.sort(compareCandidates);
  return scored[0]?.id ?? null;
}

// Soft, additive, never-absolute penalties (in ADP/searchRank-point-
// equivalent units — both scales are roughly "overall player rank," so one
// additive constant is meaningful against either). Bands start at the
// *second* owned player at a position (a first QB/TE draws no penalty at
// all), since real ADP data shows a single early QB/TE is completely
// ordinary. RB/WR bands are deliberately much lighter than QB/TE, since
// real rosters commonly carry several of each. These four bands are
// unchanged since the initial Phase 5.5 calibration; treat any future
// change to them as a deliberate, evidence-based decision (backed by
// simulation output), never a silent tuning pass to make a test happen to
// pass.
//
// K/DEF (post-5.5 product decision): initially shipped with no penalty at
// all, on the finding that real seeded ADP already places them late enough
// on its own. That finding held for *raw* ADP, but the explicit product
// decision here is stronger than "let ADP fall where it may" — K/DEF should
// be *strongly discouraged*, not merely mildly deprioritized, before the
// final 3 rounds, even overriding an attractively low raw ADP. See
// computeKDefPenalty below.
function computePositionPenalty(position: string, owned: number, isLateWindow: boolean): number {
  switch (position) {
    case "QB":
      if (owned >= 2) return 60;
      if (owned === 1) return 18;
      return 0;
    case "TE":
      if (owned >= 2) return 55;
      if (owned === 1) return 15;
      return 0;
    case "RB":
      if (owned >= 4) return 12;
      if (owned === 3) return 5;
      return 0;
    case "WR":
      if (owned >= 5) return 12;
      if (owned === 4) return 5;
      return 0;
    case "K":
    case "DEF":
      return computeKDefPenalty(owned, isLateWindow);
    default:
      // Any unrecognized position value: no penalty.
      return 0;
  }
}

// Two independent, additive components, deliberately kept separate rather
// than folded into one lookup table:
//
//   - timing: +100 before the final 3 rounds, +0 during them. Strong on
//     purpose — the product goal is "K/DEF picks should be unusual before
//     the final 3 rounds even at an attractive raw ADP," not merely
//     "slightly deprioritized." Still additive, not exclusionary: an
//     extreme enough candidate-pool situation (e.g. every remaining
//     non-K/DEF candidate has a far worse raw value) can still overcome it.
//   - duplicate: 0/+40/+80 by how many of that position this BOT already
//     owns, applied identically inside and outside the late window — a
//     second K/DEF is discouraged everywhere, just less so once K/DEF
//     picks are otherwise normal.
//
// Both apply to K and DEF identically; there is no K-specific or
// DEF-specific constant.
function computeKDefPenalty(owned: number, isLateWindow: boolean): number {
  const timingPenalty = isLateWindow ? 0 : 100;
  const duplicatePenalty = owned >= 2 ? 80 : owned === 1 ? 40 : 0;
  return timingPenalty + duplicatePenalty;
}

type Candidate = { id: string; adp: number | null; searchRank: number | null; penalty: number };

function compareId(a: string, b: string): number {
  if (a === b) return 0;
  return a < b ? -1 : 1;
}

// Explicit, branch-based comparator rather than folding null handling into
// a single numeric sentinel (e.g. `searchRank ?? Number.MAX_SAFE_INTEGER`):
// a sentinel that large would make positionPenalty numerically negligible
// against it, silently defeating position-awareness for exactly the
// null-searchRank candidates (all DEF rows, notably) it's meant to apply
// to. Each branch below mirrors Phase 5.2's original NULLS-LAST semantics
// exactly, with positionPenalty applied only where it stays meaningful
// relative to the metric it's added to.
function compareCandidates(a: Candidate, b: Candidate): number {
  const aHasAdp = a.adp !== null;
  const bHasAdp = b.adp !== null;

  // Tier precedence (Phase 5.2, preserved): any usable-ADP candidate beats
  // any no-ADP candidate, unconditionally.
  if (aHasAdp !== bHasAdp) {
    return aHasAdp ? -1 : 1;
  }

  if (aHasAdp && bHasAdp) {
    // Tier 1: adjustedScore, then raw ADP, then searchRank
    // (non-null-before-null, then ascending), then id.
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

  // Tier 2 (neither has a usable ADP for this format): a real searchRank
  // always beats a null searchRank, mirroring "NULLS LAST" exactly.
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

  // Both searchRank null (today: exclusively DEF rows) — nothing left to
  // rank by except the penalty itself, then id.
  if (a.penalty !== b.penalty) return a.penalty - b.penalty;
  return compareId(a.id, b.id);
}
