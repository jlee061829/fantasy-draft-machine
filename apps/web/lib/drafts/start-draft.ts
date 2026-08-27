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
    currentUserId: string;
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

    const members = await tx.leagueMember.findMany({
      where: { leagueId },
      select: { userId: true, draftSlot: true },
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
        currentUserId: firstPicker.userId,
        turnDeadline,
      },
    });

    return {
      draft: {
        id: draft.id,
        leagueId: draft.leagueId,
        status: draft.status,
        currentPickNumber: draft.currentPickNumber,
        currentUserId: firstPicker.userId,
        turnDeadline: turnDeadline.toISOString(),
        createdAt: draft.createdAt.toISOString(),
      },
    };
  });
}
