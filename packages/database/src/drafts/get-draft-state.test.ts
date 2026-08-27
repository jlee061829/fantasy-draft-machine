import { randomUUID } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { prisma } from "../client.js";
import { cleanupLeagueTestData, createTestPlayer, createTestUser } from "../test-support/db.js";
import { getDraftState, getDraftStateForLeague } from "./get-draft-state.js";

async function createTestLeague(ownerId: string, teamCount = 4) {
  return prisma.league.create({
    data: {
      name: "Resync Test League",
      ownerId,
      rosterSize: 16,
      teamCount,
      inviteCode: randomUUID().replace(/-/g, "").slice(0, 8).toUpperCase(),
      timerSeconds: 60,
      scoringFormat: "PPR",
      draftType: "SNAKE",
    },
  });
}

describe("getDraftStateForLeague / getDraftState", () => {
  beforeEach(async () => {
    await cleanupLeagueTestData();
  });

  afterEach(async () => {
    await cleanupLeagueTestData();
  });

  it("returns null for a nonexistent league", async () => {
    await expect(getDraftStateForLeague("nonexistent-league-id")).resolves.toBeNull();
  });

  it("collapses nonexistent league and non-member into null for getDraftState", async () => {
    const owner = await createTestUser();
    const league = await createTestLeague(owner.id);
    await prisma.leagueMember.create({
      data: { leagueId: league.id, userId: owner.id, draftSlot: 1 },
    });
    const outsider = await createTestUser();

    await expect(getDraftState(league.id, outsider.id)).resolves.toBeNull();
    await expect(getDraftState("nonexistent-league-id", owner.id)).resolves.toBeNull();
  });

  it("returns draft: null and members ordered by draftSlot before a Draft exists", async () => {
    const owner = await createTestUser();
    const secondMember = await createTestUser();
    const league = await createTestLeague(owner.id);
    // Inserted out of slot order on purpose to assert the query orders them,
    // not merely returns them in insertion order.
    await prisma.leagueMember.create({
      data: { leagueId: league.id, userId: secondMember.id, draftSlot: 2 },
    });
    await prisma.leagueMember.create({
      data: { leagueId: league.id, userId: owner.id, draftSlot: 1 },
    });

    const state = await getDraftState(league.id, owner.id);

    expect(state).not.toBeNull();
    expect(state?.draft).toBeNull();
    expect(state?.picks).toEqual([]);
    expect(state?.members.map((member) => member.draftSlot)).toEqual([1, 2]);
    expect(state?.members[0]).toMatchObject({ userId: owner.id, draftSlot: 1 });
  });

  it("returns draft state and picks ordered by pickNumber with player fields attached", async () => {
    const owner = await createTestUser();
    const league = await createTestLeague(owner.id);
    await prisma.leagueMember.create({
      data: { leagueId: league.id, userId: owner.id, draftSlot: 1 },
    });
    const playerOne = await createTestPlayer({ fullName: "Player One", position: "RB" });
    const playerTwo = await createTestPlayer({ fullName: "Player Two", position: "WR" });
    const draft = await prisma.draft.create({
      data: {
        leagueId: league.id,
        status: "ACTIVE",
        currentPickNumber: 3,
        currentUserId: owner.id,
        turnDeadline: new Date(Date.now() + 60_000),
      },
    });
    // Created out of pick-number order on purpose.
    await prisma.pick.create({
      data: {
        draftId: draft.id,
        pickNumber: 2,
        userId: owner.id,
        playerId: playerTwo.id,
        wasAutopick: false,
      },
    });
    await prisma.pick.create({
      data: {
        draftId: draft.id,
        pickNumber: 1,
        userId: owner.id,
        playerId: playerOne.id,
        wasAutopick: true,
      },
    });

    const state = await getDraftStateForLeague(league.id);

    expect(state?.draft).toMatchObject({
      status: "ACTIVE",
      currentPickNumber: 3,
      currentUserId: owner.id,
    });
    expect(state?.picks.map((pick) => pick.pickNumber)).toEqual([1, 2]);
    expect(state?.picks[0]).toMatchObject({
      playerName: "Player One",
      playerPosition: "RB",
      wasAutopick: true,
    });
    expect(state?.picks[1]).toMatchObject({
      playerName: "Player Two",
      playerPosition: "WR",
      wasAutopick: false,
    });
  });
});
