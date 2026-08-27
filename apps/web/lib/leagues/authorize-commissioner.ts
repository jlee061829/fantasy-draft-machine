import type { DraftType, Prisma } from "@fdm/database";
import { LeagueNotAccessibleError, NotLeagueOwnerError } from "@fdm/database";

export interface LockedLeague {
  id: string;
  ownerId: string;
  teamCount: number;
  timerSeconds: number;
  draftType: DraftType;
}

// Shared by every commissioner mutation (settings update, member reorder) so
// the authorization/locking rule can't drift between them. Must be called
// inside the caller's transaction, using that transaction's `tx` client, so
// the row lock it takes is held for the rest of the mutation.
//
// Locks the League row FOR UPDATE first — this is the single serialization
// point join/settings/reorder all share, so concurrent mutations against the
// same league queue behind this lock rather than racing. Then, deliberately
// in this order:
//   1. no League row for this id -> LeagueNotAccessibleError (404)
//   2. requester has no LeagueMember row for this league -> also
//      LeagueNotAccessibleError (404), collapsed with (1) the same way
//      getLeagueDetail collapses nonexistent-league and non-member access,
//      so a non-member can't distinguish the two by probing this endpoint
//   3. requester is a member but League.ownerId !== requester -> distinct
//      NotLeagueOwnerError (403) — a non-owner member already has full
//      visibility into the league via the detail page, so telling them
//      they're not the commissioner leaks nothing new
export async function authorizeLeagueOwner(
  tx: Prisma.TransactionClient,
  leagueId: string,
  requestingUserId: string,
): Promise<LockedLeague> {
  const [league] = await tx.$queryRaw<LockedLeague[]>`
    SELECT id, "ownerId", "teamCount", "timerSeconds", "draftType" FROM "League" WHERE id = ${leagueId} FOR UPDATE
  `;
  if (!league) {
    throw new LeagueNotAccessibleError();
  }

  const membership = await tx.leagueMember.findUnique({
    where: { leagueId_userId: { leagueId, userId: requestingUserId } },
  });
  if (!membership) {
    throw new LeagueNotAccessibleError();
  }

  if (league.ownerId !== requestingUserId) {
    throw new NotLeagueOwnerError();
  }

  return league;
}
