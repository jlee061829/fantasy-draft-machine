import { prisma } from "../client.js";
import { applyPick, lockDraftForLeague, type SubmitPickResult } from "./submit-pick.js";
import { selectBestAvailablePlayerId } from "./player-selection.js";
import { BotPickExhaustedError } from "./errors.js";

// Phase 5.3: the BOT counterpart to processExpiredDraftTurn. Mirrors its
// shape/spirit exactly — a discriminated result instead of thrown
// exceptions for every *expected* outcome, so apps/socket-server's bot
// sweep can decide whether to broadcast without needing try/catch to tell
// "nothing happened" apart from "an error occurred".
export type BotTurnOutcome =
  | { outcome: "picked"; leagueId: string; result: SubmitPickResult }
  | {
      outcome: "skipped";
      leagueId: string;
      reason: "NO_DRAFT" | "NOT_ACTIVE" | "NOT_BOT_TURN";
    };

// Plain, unlocked read used only to build the BOT sweep's candidate list.
// Deliberately has no deadline condition at all: a BOT's turnDeadline is
// written identically to a HUMAN's (see applyPick's unchanged "advance"
// branch) purely so the schema needs no BOT-specific field, but it is not a
// requirement to wait — participantType alone is the routing signal for
// whether a turn is eligible for BOT processing. Its staleness (the current
// participant may have changed between this read and the transaction
// acquiring the lock) is expected and safe: processBotDraftTurn re-verifies
// participantType itself, post-lock, exactly like findExpiredActiveDraftLeagueIds'
// HUMAN filter is discovery-time only for the human path.
export async function findActiveBotTurnLeagueIds(): Promise<string[]> {
  const drafts = await prisma.draft.findMany({
    where: { status: "ACTIVE", currentMember: { participantType: "BOT" } },
    select: { leagueId: true },
  });
  return drafts.map((draft) => draft.leagueId);
}

// One BOT turn, start to finish, inside one transaction:
//
//   1. lock the Draft row FOR UPDATE, scoped by leagueId (lockDraftForLeague)
//      — the same lock submitPick and processExpiredDraftTurn both use, so
//      a BOT pick serializes against a concurrent manual pick, a concurrent
//      human autopick, or another concurrent BOT-turn call exactly as those
//      already serialize against each other
//   2. if there's no Draft, or it isn't ACTIVE, return a "skipped" outcome
//   3. re-read the current LeagueMember's participantType and require BOT —
//      the authoritative check. findActiveBotTurnLeagueIds' BOT filter is
//      discovery-time only; participant identity can still change between
//      that unlocked read and this transaction acquiring the lock (a
//      concurrent human pick could have already advanced the turn to a
//      HUMAN, or a second concurrent processBotDraftTurn call for the same
//      league could have already consumed this exact BOT turn), so this
//      function never trusts the discovery query alone
//   4. read League config plainly (unlocked) — safe for the same reason
//      submitPick's/processExpiredDraftTurn's League reads are: settings/
//      reorder mutations already return 409 once a Draft exists
//   5. select the best available player (selectBestAvailablePlayerId, the
//      same shared Phase 5.2 selection primitive human timer-autopick uses)
//   6. delegate to the same applyPick used by submitPick and
//      processExpiredDraftTurn, attributing the Pick to the BOT's own
//      LeagueMember.id with wasAutopick: false — a BOT's own intentional
//      pick is not "a human missed their deadline"; the fact that a Pick
//      came from a BOT is derivable from Pick.leagueMemberId joined against
//      LeagueMember.participantType, with no new column (see CLAUDE.md's
//      PickSource deferral rationale)
//   7. commit
//
// No second Pick-writing path exists: this function is a thin orchestration
// wrapper around the identical lock/select/apply primitives every other
// pick source already shares.
export async function processBotDraftTurn(leagueId: string): Promise<BotTurnOutcome> {
  return prisma.$transaction(async (tx) => {
    const draft = await lockDraftForLeague(tx, leagueId);
    if (!draft) {
      return { outcome: "skipped", leagueId, reason: "NO_DRAFT" };
    }
    if (draft.status !== "ACTIVE" || draft.currentMemberId === null) {
      return { outcome: "skipped", leagueId, reason: "NOT_ACTIVE" };
    }

    const currentMember = await tx.leagueMember.findUniqueOrThrow({
      where: { id: draft.currentMemberId },
      select: { participantType: true },
    });
    if (currentMember.participantType !== "BOT") {
      return { outcome: "skipped", leagueId, reason: "NOT_BOT_TURN" };
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

    const playerId = await selectBestAvailablePlayerId(tx, {
      draftId: draft.id,
      scoringFormat: league.scoringFormat,
    });
    if (!playerId) {
      throw new BotPickExhaustedError(
        `No undrafted rostered Player available for draft ${draft.id} (league ${leagueId}) — ` +
          `seeded rostered Player pool is smaller than teamCount * rosterSize.`,
      );
    }

    const result = await applyPick(tx, {
      draft,
      league,
      leagueMemberId: draft.currentMemberId,
      playerId,
      wasAutopick: false,
    });

    return { outcome: "picked", leagueId, result };
  });
}
