import type { Prisma, ScoringFormat } from "../generated/prisma/client.js";
import { prisma } from "../client.js";
import { applyPick, lockDraftForLeague, type SubmitPickResult } from "./submit-pick.js";
import { AutopickExhaustedError } from "./errors.js";

// Discriminated result instead of thrown exceptions for every *expected*
// outcome. A stale/no-op sweep entry (the turn already advanced, or the
// draft is no longer ACTIVE, by the time this transaction acquires the
// Draft-row lock) is routine, not exceptional — apps/socket-server's sweep
// uses this to decide whether to broadcast, without needing to distinguish
// "nothing happened" from "an error occurred" via try/catch.
export type AutopickOutcome =
  | { outcome: "picked"; leagueId: string; result: SubmitPickResult }
  | {
      outcome: "skipped";
      leagueId: string;
      reason: "NO_DRAFT" | "NOT_ACTIVE" | "ALREADY_ADVANCED";
    };

// Plain, unlocked read used only to build the sweep's candidate list. Its
// staleness is expected and safe: processExpiredDraftTurn re-validates
// expiry under the same Draft-row lock submitPick uses, so a leagueId that
// no longer qualifies by the time it's processed just resolves to a
// "skipped" outcome instead of corrupting anything.
export async function findExpiredActiveDraftLeagueIds(): Promise<string[]> {
  const drafts = await prisma.draft.findMany({
    where: { status: "ACTIVE", turnDeadline: { lte: new Date() } },
    select: { leagueId: true },
  });
  return drafts.map((draft) => draft.leagueId);
}

// Two-tier, deterministic, position-agnostic selection — Milestone 3.4
// intentionally does not consider roster construction (see CLAUDE.md's
// "Not yet implemented: roster-position enforcement"). Both queries scope
// to Players not yet drafted in *this* Draft and run inside the caller's
// locked transaction, so nothing else can insert a competing Pick for this
// draft between selection and insert (see applyPick's caller in
// processExpiredDraftTurn below) — no retry-on-conflict loop is needed.
//
// Tier 1: best (lowest) ADP for the league's scoring format.
// Tier 2: fallback when no undrafted player has an ADP row for this format
// — lowest searchRank, nulls last, with a final `id asc` tiebreak so the
// choice is fully deterministic even when searchRank is also null for
// every remaining candidate.
async function selectAutopickPlayerId(
  tx: Prisma.TransactionClient,
  draftId: string,
  scoringFormat: ScoringFormat,
): Promise<string | null> {
  const topByAdp = await tx.playerAdp.findFirst({
    where: {
      format: scoringFormat,
      adp: { not: null },
      player: { picks: { none: { draftId } } },
    },
    orderBy: { adp: "asc" },
    select: { playerId: true },
  });
  if (topByAdp) {
    return topByAdp.playerId;
  }

  const topBySearchRank = await tx.player.findFirst({
    where: { picks: { none: { draftId } } },
    orderBy: [{ searchRank: { sort: "asc", nulls: "last" } }, { id: "asc" }],
    select: { id: true },
  });
  return topBySearchRank?.id ?? null;
}

// The turn-expiry counterpart to submitPick: the only other writer of Pick
// rows. Locks the same Draft row submitPick locks, so the two serialize
// against each other exactly as two concurrent submitPick calls already
// do — whichever transaction acquires the lock first proceeds, and the
// loser re-reads post-commit state under its own lock.
//
//   1. lock the Draft row FOR UPDATE, scoped by leagueId (lockDraftForLeague)
//   2. if there's no Draft, or it isn't ACTIVE, or its turnDeadline hasn't
//      actually passed *as re-checked inside the lock*, return a "skipped"
//      outcome — this is what makes a stale sweep-discovery entry (e.g. a
//      manual pick consumed the turn and issued a new deadline between
//      discovery and this transaction acquiring the lock) a safe no-op
//      instead of a duplicate/incorrect autopick
//   3. read League config plainly (unlocked) — safe for the same reason
//      submitPick's League read is: settings/reorder mutations already
//      return 409 once a Draft exists
//   4. select the best available player (selectAutopickPlayerId)
//   5. delegate to the same applyPick used by submitPick, with
//      wasAutopick: true — identical Pick-insert/completion/advance logic,
//      so SNAKE/LINEAR progression and turnDeadline math can never drift
//      between manual and automatic picks
//   6. commit
export async function processExpiredDraftTurn(leagueId: string): Promise<AutopickOutcome> {
  return prisma.$transaction(async (tx) => {
    const draft = await lockDraftForLeague(tx, leagueId);
    if (!draft) {
      return { outcome: "skipped", leagueId, reason: "NO_DRAFT" };
    }
    if (draft.status !== "ACTIVE" || draft.currentUserId === null) {
      return { outcome: "skipped", leagueId, reason: "NOT_ACTIVE" };
    }
    if (!draft.turnDeadline || draft.turnDeadline.getTime() > Date.now()) {
      return { outcome: "skipped", leagueId, reason: "ALREADY_ADVANCED" };
    }

    const league = await tx.league.findUniqueOrThrow({
      where: { id: leagueId },
      select: {
        teamCount: true,
        rosterSize: true,
        draftType: true,
        timerSeconds: true,
        scoringFormat: true,
      },
    });

    const playerId = await selectAutopickPlayerId(tx, draft.id, league.scoringFormat);
    if (!playerId) {
      throw new AutopickExhaustedError(
        `No undrafted Player available for draft ${draft.id} (league ${leagueId}) — seeded ` +
          `Player pool is smaller than teamCount * rosterSize.`,
      );
    }

    const result = await applyPick(tx, {
      draft,
      league,
      userId: draft.currentUserId,
      playerId,
      wasAutopick: true,
    });

    return { outcome: "picked", leagueId, result };
  });
}
