import { DraftAlreadyStartedError, prisma } from "@fdm/database";
import { getDraftForLeague } from "../drafts/get-draft-for-league";
import { authorizeLeagueOwner } from "./authorize-commissioner";

export interface RemoveBotLeagueMembersResult {
  botsRemoved: number;
  members: Array<{
    membershipId: string;
    participantType: "HUMAN" | "BOT";
    userId: string | null;
    name: string;
    image: string | null;
    draftSlot: number;
  }>;
}

// Phase 5.4: removes every BOT LeagueMember for the league, reopening their
// draft slots. Deletes only participantType === "BOT" rows — HUMAN rows are
// never touched by this query.
//
// This is safe pre-Draft specifically because a BOT with no Draft yet has
// no Pick history: Pick.leagueMemberId is onDelete: Restrict (Phase 5.1),
// but that only trips once a Pick actually references a LeagueMember, which
// cannot happen before a Draft exists (submitPick/applyPick require an
// ACTIVE Draft). This is unrelated to the known League-deletion FK-ordering
// issue, which is about deleting a League that already has Draft/Pick
// history — not relevant here since Fill/Remove are both draft-existence
// gated to "no Draft yet."
//
// Reuses the same authorizeLeagueOwner (League row lock + ownership check)
// + getDraftForLeague (draft-existence guard) primitives as
// fillOpenLeagueSlotsWithBots and every other pre-Draft membership
// mutation. Idempotent: zero BOT rows is a normal success (botsRemoved: 0),
// not an error.
export async function removeBotLeagueMembers(
  leagueId: string,
  requestingUserId: string,
): Promise<RemoveBotLeagueMembersResult> {
  return prisma.$transaction(async (tx) => {
    await authorizeLeagueOwner(tx, leagueId, requestingUserId);

    const existingDraft = await getDraftForLeague(tx, leagueId);
    if (existingDraft) {
      throw new DraftAlreadyStartedError();
    }

    const { count } = await tx.leagueMember.deleteMany({
      where: { leagueId, participantType: "BOT" },
    });

    const members = await tx.leagueMember.findMany({
      where: { leagueId },
      select: {
        id: true,
        userId: true,
        participantType: true,
        displayName: true,
        draftSlot: true,
        user: { select: { name: true, image: true } },
      },
      orderBy: { draftSlot: "asc" },
    });

    return {
      botsRemoved: count,
      members: members.map((member) => ({
        membershipId: member.id,
        participantType: member.participantType,
        userId: member.userId,
        name: member.participantType === "BOT" ? member.displayName! : member.user!.name,
        image: member.participantType === "BOT" ? null : (member.user?.image ?? null),
        draftSlot: member.draftSlot,
      })),
    };
  });
}
