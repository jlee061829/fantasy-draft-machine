import { prisma } from "@fdm/database";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { cleanupLeagueTestData, createTestUser } from "../../test/db";
import { createLeague } from "./create-league";
import { LeagueFullError, ReorderMembershipMismatchError, TeamCountBelowMembershipError } from "./errors";
import { joinLeague } from "./join-league";
import { reorderLeagueMembers } from "./reorder-league-members";
import { updateLeagueSettings } from "./update-league-settings";

async function createTestLeague(ownerId: string, teamCount: number) {
  return createLeague(
    {
      name: "Concurrency Test League",
      rosterSize: 16,
      teamCount,
      timerSeconds: 60,
      scoringFormat: "PPR",
      draftType: "SNAKE",
    },
    ownerId,
  );
}

async function allSlots(leagueId: string) {
  return prisma.leagueMember.findMany({
    where: { leagueId },
    select: { id: true, userId: true, draftSlot: true },
  });
}

describe("commissioner mutation concurrency", () => {
  beforeEach(async () => {
    await cleanupLeagueTestData();
  });

  afterEach(async () => {
    await cleanupLeagueTestData();
  });

  // With League-row serialization, two reorder requests can both legitimately
  // succeed serially (last-writer-wins) - this is acceptable behavior for
  // this milestone, not a race to prevent. The invariant is that the final
  // state is exactly one of the two complete submitted orders, never a
  // mixed/corrupted combination.
  it("under two simultaneous reorders, both may succeed and the final order matches exactly one submission", async () => {
    const owner = await createTestUser();
    const { league, membership: m1 } = await createTestLeague(owner.id, 4);
    const users = await Promise.all([createTestUser(), createTestUser(), createTestUser()]);
    const m2 = await prisma.leagueMember.create({
      data: { leagueId: league.id, userId: users[0]!.id, draftSlot: 2 },
    });
    const m3 = await prisma.leagueMember.create({
      data: { leagueId: league.id, userId: users[1]!.id, draftSlot: 3 },
    });
    const m4 = await prisma.leagueMember.create({
      data: { leagueId: league.id, userId: users[2]!.id, draftSlot: 4 },
    });

    const orderA = [m4.id, m3.id, m2.id, m1.id];
    const orderB = [m2.id, m1.id, m4.id, m3.id];

    const outcomes = await Promise.allSettled([
      reorderLeagueMembers(league.id, { memberIds: orderA }, owner.id),
      reorderLeagueMembers(league.id, { memberIds: orderB }, owner.id),
    ]);

    for (const outcome of outcomes) {
      expect(outcome.status).toBe("fulfilled");
    }

    const finalMembers = await prisma.leagueMember.findMany({
      where: { leagueId: league.id },
      orderBy: { draftSlot: "asc" },
      select: { id: true, draftSlot: true },
    });
    const finalSlots = finalMembers.map((m) => m.draftSlot);
    expect(finalSlots).toEqual([1, 2, 3, 4]);
    expect(new Set(finalSlots).size).toBe(4);

    const finalOrder = finalMembers.map((m) => m.id);
    const matchesA = JSON.stringify(finalOrder) === JSON.stringify(orderA);
    const matchesB = JSON.stringify(finalOrder) === JSON.stringify(orderB);
    expect(matchesA || matchesB).toBe(true);
  });

  // Two documented, equally correct outcomes depending on lock-acquisition
  // order: (A) reorder locks first, succeeds, then the join lands the new
  // member in a fresh valid slot; or (B) the join locks first, adds a
  // member, and the reorder's now-stale submission (missing the new member)
  // is correctly rejected, leaving the pre-reorder order (including the new
  // member) fully intact. Both are correct; the test must not assume one.
  it("under a reorder racing a join, the join always succeeds and the reorder outcome is consistent with lock order", async () => {
    const owner = await createTestUser();
    const { league, membership: m1 } = await createTestLeague(owner.id, 4);
    const users = await Promise.all([createTestUser(), createTestUser()]);
    const m2 = await prisma.leagueMember.create({
      data: { leagueId: league.id, userId: users[0]!.id, draftSlot: 2 },
    });
    const m3 = await prisma.leagueMember.create({
      data: { leagueId: league.id, userId: users[1]!.id, draftSlot: 3 },
    });
    const beforeSlots = new Map([
      [m1.id, 1],
      [m2.id, 2],
      [m3.id, 3],
    ]);

    const newJoiner = await createTestUser();
    const reorderIds = [m3.id, m1.id, m2.id];

    const [reorderOutcome, joinOutcome] = await Promise.allSettled([
      reorderLeagueMembers(league.id, { memberIds: reorderIds }, owner.id),
      joinLeague(league.inviteCode, newJoiner.id),
    ]);

    // Capacity (4) is never actually contested by this race - it only goes
    // from 3 to 4 members - so the join always succeeds regardless of which
    // transaction wins the lock.
    expect(joinOutcome.status).toBe("fulfilled");

    const finalMembers = await allSlots(league.id);
    expect(finalMembers).toHaveLength(4);
    const finalSlots = finalMembers.map((m) => m.draftSlot).sort((a, b) => a - b);
    expect(finalSlots).toEqual([1, 2, 3, 4]);
    expect(new Set(finalSlots).size).toBe(4);

    const newMemberRow = finalMembers.find((m) => m.userId === newJoiner.id);
    expect(newMemberRow).toBeDefined();

    if (reorderOutcome.status === "fulfilled") {
      // Outcome A: reorder committed first with its full requested order.
      const originalThree = finalMembers
        .filter((m) => m.id !== newMemberRow!.id)
        .sort((a, b) => a.draftSlot - b.draftSlot)
        .map((m) => m.id);
      expect(originalThree).toEqual(reorderIds);
    } else {
      // Outcome B: the join won the lock first, so the reorder's submission
      // (missing the new member) was stale and correctly rejected. No
      // partial reorder should be persisted - the three original members
      // keep exactly their pre-race slots.
      expect(reorderOutcome.reason).toBeInstanceOf(ReorderMembershipMismatchError);
      for (const [id, slot] of beforeSlots) {
        expect(finalMembers.find((m) => m.id === id)?.draftSlot).toBe(slot);
      }
    }
  });

  // At the exact boundary (requested teamCount === current member count),
  // whichever transaction wins the League row lock is authoritative and the
  // loser correctly fails against the now-current state - never both
  // succeeding (which would leave memberCount > teamCount) and never both
  // failing (the winner's view of state is always internally consistent).
  it("under a teamCount decrease racing a join at the exact boundary, exactly one operation succeeds", async () => {
    const owner = await createTestUser();
    const { league } = await createTestLeague(owner.id, 4);
    const users = await Promise.all([createTestUser(), createTestUser()]);
    await prisma.leagueMember.create({
      data: { leagueId: league.id, userId: users[0]!.id, draftSlot: 2 },
    });
    await prisma.leagueMember.create({
      data: { leagueId: league.id, userId: users[1]!.id, draftSlot: 3 },
    });
    // 3 members occupy slots {1,2,3}; teamCount is currently 4.

    const newJoiner = await createTestUser();

    const [settingsOutcome, joinOutcome] = await Promise.allSettled([
      updateLeagueSettings(league.id, { teamCount: 3 }, owner.id),
      joinLeague(league.inviteCode, newJoiner.id),
    ]);

    const fulfilledCount = [settingsOutcome, joinOutcome].filter(
      (o) => o.status === "fulfilled",
    ).length;
    expect(fulfilledCount).toBe(1);

    const finalLeague = await prisma.league.findUnique({ where: { id: league.id } });
    const finalMemberCount = await prisma.leagueMember.count({ where: { leagueId: league.id } });
    expect(finalMemberCount).toBeLessThanOrEqual(finalLeague!.teamCount);

    if (settingsOutcome.status === "fulfilled") {
      expect(joinOutcome.status).toBe("rejected");
      expect((joinOutcome as PromiseRejectedResult).reason).toBeInstanceOf(LeagueFullError);
      expect(finalLeague?.teamCount).toBe(3);
      expect(finalMemberCount).toBe(3);
    } else {
      expect(joinOutcome.status).toBe("fulfilled");
      expect((settingsOutcome as PromiseRejectedResult).reason).toBeInstanceOf(
        TeamCountBelowMembershipError,
      );
      expect(finalLeague?.teamCount).toBe(4);
      expect(finalMemberCount).toBe(4);
    }
  });
});
