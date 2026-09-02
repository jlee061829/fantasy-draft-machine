import { prisma } from "@fdm/database";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { cleanupLeagueTestData, createTestUser } from "@fdm/database/test-support";
import { createLeague } from "./create-league";
import { getMyLeagues } from "./get-my-leagues";

async function createTestLeague(name: string, ownerId: string) {
  return createLeague(
    {
      name,
      rosterSize: 16,
      teamCount: 12,
      timerSeconds: 60,
      scoringFormat: "PPR",
      draftType: "SNAKE",
    },
    ownerId,
  );
}

describe("getMyLeagues", () => {
  beforeEach(async () => {
    await cleanupLeagueTestData();
  });

  afterEach(async () => {
    await cleanupLeagueTestData();
  });

  it("includes a league the user owns", async () => {
    const owner = await createTestUser();
    const { league } = await createTestLeague("Owned League", owner.id);

    const result = await getMyLeagues(owner.id);

    expect(result).toHaveLength(1);
    expect(result[0]).toEqual({
      id: league.id,
      name: "Owned League",
      ownerId: owner.id,
      teamCount: 12,
      scoringFormat: "PPR",
      draftType: "SNAKE",
    });
  });

  it("includes a league the user joined without owning it", async () => {
    const owner = await createTestUser();
    const joiner = await createTestUser();
    const { league } = await createTestLeague("Joined League", owner.id);
    await prisma.leagueMember.create({
      data: { leagueId: league.id, userId: joiner.id, draftSlot: 2 },
    });

    const result = await getMyLeagues(joiner.id);

    expect(result).toHaveLength(1);
    expect(result[0]?.id).toBe(league.id);
    expect(result[0]?.ownerId).toBe(owner.id);
  });

  it("does not use ownerId as a separate inclusion path — an owner without a membership row is excluded", async () => {
    const owner = await createTestUser();
    const { league } = await createTestLeague("Ownerless Membership League", owner.id);

    // Membership is the sole source of truth per CLAUDE.md: simulate a league
    // whose owner's own LeagueMember row was removed, and assert it does not
    // leak back in through League.ownerId.
    await prisma.leagueMember.deleteMany({ where: { leagueId: league.id, userId: owner.id } });

    const result = await getMyLeagues(owner.id);

    expect(result.find((l) => l.id === league.id)).toBeUndefined();
  });

  it("excludes leagues belonging only to another user", async () => {
    const owner = await createTestUser();
    const stranger = await createTestUser();
    await createTestLeague("Stranger League", owner.id);

    const result = await getMyLeagues(stranger.id);

    expect(result).toHaveLength(0);
  });

  it("returns an empty array for a user with no leagues", async () => {
    const user = await createTestUser();

    const result = await getMyLeagues(user.id);

    expect(result).toEqual([]);
  });
});
