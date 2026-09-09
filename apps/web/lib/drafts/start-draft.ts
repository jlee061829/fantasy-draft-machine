import type { DraftStatus } from "@fdm/database";
import { prisma } from "@fdm/database";
import { getPickerForPickNumber } from "@fdm/shared";
import { authorizeLeagueOwner } from "../leagues/authorize-commissioner";
import { DraftAlreadyExistsError, LeagueNotFullError } from "@fdm/database";
import { getDraftForLeague } from "./get-draft-for-league";

export interface StartDraftResult {
  draft: {
    id: string;
    leagueId: string;
    status: DraftStatus;
    currentPickNumber: number;
    // Phase 5.1: renamed from currentUserId — the first picker's own
    // LeagueMember.id, not a User id. The fullness check just below
    // (memberCount === teamCount) is unchanged: a BOT LeagueMember row
    // counts toward that total exactly like a HUMAN row, so "full" already
    // means "every slot occupied by a participant" with no special-casing
    // for bots here.
    currentMemberId: string;
    turnDeadline: string;
    createdAt: string;
  };
}

// Reaching this means persisted LeagueMember rows violate an invariant that
// should be impossible once memberCount === teamCount has just been checked
// in the same transaction (every slot 1..teamCount should be occupied).
// Deliberately NOT one of the domain errors the route maps to a 4xx —
// hitting this indicates corrupted/impossible server-side state, not a
// legitimate client-triggerable conflict, so it's left to propagate as an
// unhandled error (500), the same as any other unexpected internal failure.
class DraftInitializationInvariantError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DraftInitializationInvariantError";
  }
}

// Mirrors the join/settings/reorder lock convention: lock the League row via
// authorizeLeagueOwner first, so a concurrent start attempt (or a concurrent
// settings/reorder mutation) for the same league serializes behind this one
// rather than racing it. Draft.leagueId's DB-level unique constraint remains
// a backstop, but under this lock the app-level existence check above should
// already make a second create unreachable.
export async function startDraft(
  leagueId: string,
  requestingUserId: string,
): Promise<StartDraftResult> {
  return prisma.$transaction(async (tx) => {
    const league = await authorizeLeagueOwner(tx, leagueId, requestingUserId);

    const existingDraft = await getDraftForLeague(tx, leagueId);
    if (existingDraft) {
      throw new DraftAlreadyExistsError();
    }

    // Phase 5.1: a BOT LeagueMember row counts toward memberCount exactly
    // like a HUMAN row (both are just LeagueMember rows), so this fullness
    // check needs no change to support a mixed human/bot league — "full"
    // already means "every slot 1..teamCount has a participant."
    const members = await tx.leagueMember.findMany({
      where: { leagueId },
      select: { id: true, draftSlot: true },
    });
    if (members.length !== league.teamCount) {
      throw new LeagueNotFullError();
    }

    const firstSlot = getPickerForPickNumber(1, league.teamCount, league.draftType);
    const firstPicker = members.find((member) => member.draftSlot === firstSlot);
    if (!firstPicker) {
      throw new DraftInitializationInvariantError(
        `No LeagueMember at draftSlot ${firstSlot} for league ${leagueId} despite memberCount === teamCount.`,
      );
    }

    const turnDeadline = new Date(Date.now() + league.timerSeconds * 1000);
    const draft = await tx.draft.create({
      data: {
        leagueId,
        status: "ACTIVE",
        currentPickNumber: 1,
        // The first picker's own LeagueMember.id — works identically
        // whether that slot is occupied by a HUMAN or a BOT.
        currentMemberId: firstPicker.id,
        turnDeadline,
      },
    });

    return {
      draft: {
        id: draft.id,
        leagueId: draft.leagueId,
        status: draft.status,
        currentPickNumber: draft.currentPickNumber,
        currentMemberId: firstPicker.id,
        turnDeadline: turnDeadline.toISOString(),
        createdAt: draft.createdAt.toISOString(),
      },
    };
  });
}
