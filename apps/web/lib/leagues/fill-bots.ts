import { DraftAlreadyStartedError, prisma } from "@fdm/database";
import { getDraftForLeague } from "../drafts/get-draft-for-league";
import { authorizeLeagueOwner } from "./authorize-commissioner";

export interface FillOpenLeagueSlotsResult {
  botsCreated: number;
  members: Array<{
    membershipId: string;
    // Same normalized HUMAN/BOT shape as getLeagueDetail/reorderLeagueMembers
    // (see those files) — callers never branch on participantType for
    // display purposes.
    participantType: "HUMAN" | "BOT";
    userId: string | null;
    name: string;
    image: string | null;
    draftSlot: number;
  }>;
}

// Phase 5.4: fills every currently-open draft slot (1..teamCount) with a BOT
// LeagueMember in one atomic operation. This is the first production code
// path that can ever create a BOT LeagueMember — until now bots existed
// only via the test-only createTestBotMember fixture (see
// packages/database/src/test-support/db.ts).
//
// Reuses the exact commissioner-authorization + League-row-lock +
// draft-existence-guard primitives every other pre-Draft membership
// mutation already uses (authorizeLeagueOwner locks the League row FOR
// UPDATE and checks ownership; getDraftForLeague rejects once a Draft
// exists) — see join-league.ts/reorder-league-members.ts for the identical
// shape. No second lock primitive is introduced.
//
// Idempotent: zero open slots is a normal success (botsCreated: 0), not a
// conflict — "fill whatever is open" is trivially satisfied when nothing is
// open. Two concurrent Fill calls for the same league serialize on the
// League row lock: whichever transaction commits first fills the slots that
// were actually open when it acquired the lock; the second call only
// acquires the lock afterward, re-reads membership fresh under that lock,
// and therefore sees a smaller (possibly empty) open-slot set — it can
// never create a duplicate bot or collide on a draftSlot, because the
// open-slot computation and the insert happen inside the same locked
// transaction with no gap between them.
//
// A concurrent HUMAN join (join-league.ts) locks the identical League row
// via its own SELECT ... FOR UPDATE, so it serializes against this
// operation the same way: whichever of {join, fill} commits first is seen
// by the other once it acquires the lock. Neither can overwrite or
// displace the other — see fill-bots.test.ts for a real-Postgres
// concurrency test proving both valid outcomes.
//
// BOT display names are stable ordinals ("CPU 1", "CPU 2", ...), not named
// after the draftSlot they fill — a pre-Draft reorder can move a bot to a
// different slot afterward, which would make a slot-based name stale and
// misleading. The ordinal continues from however many BOT rows already
// exist in the league, so a second Fill call (e.g. after Remove Bots
// reopened slots, or after teamCount was raised) never reuses an ordinal
// already in use by a bot from an earlier Fill.
export async function fillOpenLeagueSlotsWithBots(
  leagueId: string,
  requestingUserId: string,
): Promise<FillOpenLeagueSlotsResult> {
  return prisma.$transaction(async (tx) => {
    const league = await authorizeLeagueOwner(tx, leagueId, requestingUserId);

    const existingDraft = await getDraftForLeague(tx, leagueId);
    if (existingDraft) {
      throw new DraftAlreadyStartedError();
    }

    const members = await tx.leagueMember.findMany({
      where: { leagueId },
      select: { draftSlot: true, participantType: true },
    });

    const occupied = new Set(members.map((m) => m.draftSlot));
    const openSlots: number[] = [];
    for (let slot = 1; slot <= league.teamCount; slot++) {
      if (!occupied.has(slot)) openSlots.push(slot);
    }

    if (openSlots.length > 0) {
      const existingBotCount = members.filter((m) => m.participantType === "BOT").length;

      await tx.leagueMember.createMany({
        data: openSlots.map((slot, index) => ({
          leagueId,
          draftSlot: slot,
          participantType: "BOT" as const,
          displayName: `CPU ${existingBotCount + index + 1}`,
        })),
      });
    }

    const finalMembers = await tx.leagueMember.findMany({
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
      botsCreated: openSlots.length,
      members: finalMembers.map((member) => ({
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
