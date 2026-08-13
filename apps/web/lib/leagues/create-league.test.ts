import { prisma } from "@fdm/database";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { cleanupLeagueTestData, createTestUser } from "../../test/db";
import { createLeague } from "./create-league";

// Atomicity is a structural property of create-league.ts (a single
// prisma.$transaction call containing both writes, with no other code path
// that creates a League) rather than something forced and observed here —
// there's no realistic way to make the LeagueMember insert fail through this
// public interface, since draftSlot: 1 against a freshly generated leagueId
// can't collide with the (leagueId, draftSlot) unique constraint.
describe("createLeague", () => {
  beforeEach(async () => {
    await cleanupLeagueTestData();
  });

  afterEach(async () => {
    await cleanupLeagueTestData();
  });

  it("creates the league and the creator's membership atomically", async () => {
    const user = await createTestUser();

    const result = await createLeague(
      {
        name: "Integration League",
        rosterSize: 16,
        timerSeconds: 60,
        scoringFormat: "PPR",
        draftType: "SNAKE",
      },
      user.id,
    );

    expect(result.league.ownerId).toBe(user.id);
    expect(result.membership.draftSlot).toBe(1);

    const leagues = await prisma.league.findMany({ where: { ownerId: user.id } });
    expect(leagues).toHaveLength(1);
    expect(leagues[0]?.id).toBe(result.league.id);

    const memberships = await prisma.leagueMember.findMany({
      where: { leagueId: result.league.id },
    });
    expect(memberships).toHaveLength(1);
    expect(memberships[0]?.userId).toBe(user.id);
    expect(memberships[0]?.draftSlot).toBe(1);
  });
});
