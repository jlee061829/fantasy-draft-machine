import { prisma } from "@fdm/database";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { cleanupLeagueTestData, createTestUser } from "../../test/db";
import { createLeague } from "./create-league";
import { AlreadyMemberError, LeagueFullError, LeagueNotFoundError } from "./errors";
import { joinLeague } from "./join-league";

async function createTestLeague(ownerId: string, teamCount = 12) {
  return createLeague(
    {
      name: "Join Test League",
      rosterSize: 16,
      teamCount,
      timerSeconds: 60,
      scoringFormat: "PPR",
      draftType: "SNAKE",
    },
    ownerId,
  );
}

describe("joinLeague", () => {
  beforeEach(async () => {
    await cleanupLeagueTestData();
  });

  afterEach(async () => {
    await cleanupLeagueTestData();
  });

  it("lets a second user join and assigns the next draft slot", async () => {
    const owner = await createTestUser();
    const joiner = await createTestUser();
    const { league } = await createTestLeague(owner.id);

    const result = await joinLeague(league.inviteCode, joiner.id);

    expect(result.league.id).toBe(league.id);
    expect(result.membership.draftSlot).toBe(2);

    const membership = await prisma.leagueMember.findUnique({
      where: { leagueId_userId: { leagueId: league.id, userId: joiner.id } },
    });
    expect(membership?.draftSlot).toBe(2);
  });

  it("rejects a duplicate join by an existing member", async () => {
    const owner = await createTestUser();
    const joiner = await createTestUser();
    const { league } = await createTestLeague(owner.id);

    await joinLeague(league.inviteCode, joiner.id);

    await expect(joinLeague(league.inviteCode, joiner.id)).rejects.toBeInstanceOf(
      AlreadyMemberError,
    );

    const memberships = await prisma.leagueMember.findMany({
      where: { leagueId: league.id },
    });
    expect(memberships).toHaveLength(2);
  });

  it("rejects an unknown invite code", async () => {
    const joiner = await createTestUser();

    await expect(joinLeague("ZZZZZZZZ", joiner.id)).rejects.toBeInstanceOf(
      LeagueNotFoundError,
    );
  });

  it("rejects joining a league that is already at capacity", async () => {
    const owner = await createTestUser();
    const { league } = await createTestLeague(owner.id, 4);

    const joiners = await Promise.all([
      createTestUser(),
      createTestUser(),
      createTestUser(),
    ]);
    for (const joiner of joiners) {
      await joinLeague(league.inviteCode, joiner.id);
    }

    const overflowJoiner = await createTestUser();
    await expect(joinLeague(league.inviteCode, overflowJoiner.id)).rejects.toBeInstanceOf(
      LeagueFullError,
    );
  });

  it("fills the lowest available slot when a gap exists", async () => {
    const owner = await createTestUser();
    const { league } = await createTestLeague(owner.id, 6);

    // Construct occupied slots {1, 2, 4} directly via Prisma test setup —
    // slot 3 deliberately left open, without any leave/kick feature.
    const memberAtSlot2 = await createTestUser();
    const memberAtSlot4 = await createTestUser();
    await prisma.leagueMember.create({
      data: { leagueId: league.id, userId: memberAtSlot2.id, draftSlot: 2 },
    });
    await prisma.leagueMember.create({
      data: { leagueId: league.id, userId: memberAtSlot4.id, draftSlot: 4 },
    });

    const joiner = await createTestUser();
    const result = await joinLeague(league.inviteCode, joiner.id);

    expect(result.membership.draftSlot).toBe(3);
  });

  it("under concurrent joins near capacity, admits exactly the remaining slots with no duplicates", async () => {
    const owner = await createTestUser();
    const { league } = await createTestLeague(owner.id, 4);

    // Creator already occupies slot 1, so 3 slots remain. Fire 8 concurrent
    // joins from 8 distinct users to force the capacity race.
    const joiners = await Promise.all(Array.from({ length: 8 }, () => createTestUser()));
    const outcomes = await Promise.allSettled(
      joiners.map((joiner) => joinLeague(league.inviteCode, joiner.id)),
    );

    const fulfilled = outcomes.filter((o) => o.status === "fulfilled");
    const rejected = outcomes.filter((o) => o.status === "rejected");
    expect(fulfilled).toHaveLength(3);
    expect(rejected).toHaveLength(5);
    for (const outcome of rejected) {
      if (outcome.status === "rejected") {
        expect(outcome.reason).toBeInstanceOf(LeagueFullError);
      }
    }

    const memberships = await prisma.leagueMember.findMany({
      where: { leagueId: league.id },
      select: { draftSlot: true },
    });
    expect(memberships).toHaveLength(4);
    const slots = memberships.map((m) => m.draftSlot).sort((a, b) => a - b);
    expect(slots).toEqual([1, 2, 3, 4]);
  });

  it("under concurrent duplicate joins from the same user, admits exactly one membership", async () => {
    const owner = await createTestUser();
    const joiner = await createTestUser();
    const { league } = await createTestLeague(owner.id, 12);

    const outcomes = await Promise.allSettled(
      Array.from({ length: 10 }, () => joinLeague(league.inviteCode, joiner.id)),
    );

    const fulfilled = outcomes.filter((o) => o.status === "fulfilled");
    const rejected = outcomes.filter((o) => o.status === "rejected");
    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(9);
    for (const outcome of rejected) {
      if (outcome.status === "rejected") {
        expect(outcome.reason).toBeInstanceOf(AlreadyMemberError);
      }
    }

    const memberships = await prisma.leagueMember.findMany({
      where: { leagueId: league.id, userId: joiner.id },
    });
    expect(memberships).toHaveLength(1);
  });
});
