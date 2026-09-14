import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { prisma } from "../client.js";
import { cleanupLeagueTestData, createTestPlayer } from "../test-support/db.js";
import type { ScoringFormat } from "../generated/prisma/client.js";
import { getPositionalAdpRank } from "./positional-adp-rank.js";

async function createRankedPlayer(
  position: string,
  format: ScoringFormat,
  adp: number,
  overrides: Partial<{ searchRank: number | null; fullName: string }> = {},
) {
  const player = await createTestPlayer({ nflTeam: "KC", position, ...overrides });
  await prisma.playerAdp.create({ data: { playerId: player.id, format, adp, source: "test" } });
  return player;
}

describe("getPositionalAdpRank", () => {
  beforeEach(async () => {
    await cleanupLeagueTestData();
  });

  afterEach(async () => {
    await cleanupLeagueTestData();
  });

  it("ranks a known QB pool exactly by ADP ascending", async () => {
    const qbs = [];
    for (let i = 1; i <= 10; i++) {
      qbs.push(await createRankedPlayer("QB", "PPR", i * 10));
    }

    for (let i = 0; i < qbs.length; i++) {
      const rank = await prisma.$transaction((tx) =>
        getPositionalAdpRank(tx, { playerId: qbs[i]!.id, position: "QB", scoringFormat: "PPR" }),
      );
      expect(rank, `QB${i + 1}`).toBe(i + 1);
    }
  });

  it("is sensitive to scoring format", async () => {
    const a = await createTestPlayer({ nflTeam: "KC", position: "TE" });
    await prisma.playerAdp.create({ data: { playerId: a.id, format: "PPR", adp: 5, source: "test" } });
    await prisma.playerAdp.create({ data: { playerId: a.id, format: "STANDARD", adp: 50, source: "test" } });
    const b = await createTestPlayer({ nflTeam: "KC", position: "TE" });
    await prisma.playerAdp.create({ data: { playerId: b.id, format: "PPR", adp: 50, source: "test" } });
    await prisma.playerAdp.create({ data: { playerId: b.id, format: "STANDARD", adp: 5, source: "test" } });

    const aRankPpr = await prisma.$transaction((tx) =>
      getPositionalAdpRank(tx, { playerId: a.id, position: "TE", scoringFormat: "PPR" }),
    );
    const aRankStandard = await prisma.$transaction((tx) =>
      getPositionalAdpRank(tx, { playerId: a.id, position: "TE", scoringFormat: "STANDARD" }),
    );
    expect(aRankPpr).toBe(1);
    expect(aRankStandard).toBe(2);
  });

  it("only compares within the same position", async () => {
    const qb = await createRankedPlayer("QB", "PPR", 1);
    // A far-better-ADP RB must not affect the QB's positional rank.
    await createRankedPlayer("RB", "PPR", 0.5);

    const rank = await prisma.$transaction((tx) =>
      getPositionalAdpRank(tx, { playerId: qb.id, position: "QB", scoringFormat: "PPR" }),
    );
    expect(rank).toBe(1);
  });

  it("breaks an exact ADP tie by searchRank, then by id", async () => {
    const better = await createRankedPlayer("TE", "PPR", 20, { searchRank: 5 });
    const worse = await createRankedPlayer("TE", "PPR", 20, { searchRank: 10 });

    const betterRank = await prisma.$transaction((tx) =>
      getPositionalAdpRank(tx, { playerId: better.id, position: "TE", scoringFormat: "PPR" }),
    );
    const worseRank = await prisma.$transaction((tx) =>
      getPositionalAdpRank(tx, { playerId: worse.id, position: "TE", scoringFormat: "PPR" }),
    );
    expect(betterRank).toBe(1);
    expect(worseRank).toBe(2);
  });

  it("returns null when the player has no usable ADP row for the format", async () => {
    const player = await createTestPlayer({ nflTeam: "KC", position: "QB" });
    await createRankedPlayer("QB", "PPR", 1); // another QB with real ADP, for a non-empty pool

    const rank = await prisma.$transaction((tx) =>
      getPositionalAdpRank(tx, { playerId: player.id, position: "QB", scoringFormat: "PPR" }),
    );
    expect(rank).toBeNull();
  });

  it("returns null (rather than throwing) when no player of that position has any usable ADP", async () => {
    const player = await createTestPlayer({ nflTeam: "KC", position: "DEF" });

    const rank = await prisma.$transaction((tx) =>
      getPositionalAdpRank(tx, { playerId: player.id, position: "DEF", scoringFormat: "PPR" }),
    );
    expect(rank).toBeNull();
  });

  it("rank is static: unaffected by another player's Pick (drafted) status", async () => {
    const qb1 = await createRankedPlayer("QB", "PPR", 10);
    const qb2 = await createRankedPlayer("QB", "PPR", 20);

    const league = await prisma.league.create({
      data: {
        name: "Rank Static Test League",
        ownerId: (await prisma.user.create({ data: { email: "static@test.com", name: "Static" } })).id,
        rosterSize: 15,
        teamCount: 4,
        inviteCode: "STATIC01",
        timerSeconds: 60,
        scoringFormat: "PPR",
        draftType: "SNAKE",
      },
    });
    const bot = await prisma.leagueMember.create({
      data: { leagueId: league.id, draftSlot: 1, participantType: "BOT", displayName: "CPU", botStrategy: "BALANCED" },
    });
    const draft = await prisma.draft.create({
      data: { leagueId: league.id, status: "ACTIVE", currentPickNumber: 1, currentMemberId: bot.id },
    });

    // Drafting qb1 (the higher-ranked QB) away must not change qb2's own
    // static positional rank — rank is computed against the full rostered
    // population, never "remaining undrafted."
    await prisma.pick.create({ data: { draftId: draft.id, leagueMemberId: bot.id, playerId: qb1.id, pickNumber: 1 } });

    const rank = await prisma.$transaction((tx) =>
      getPositionalAdpRank(tx, { playerId: qb2.id, position: "QB", scoringFormat: "PPR" }),
    );
    expect(rank).toBe(2);
  });
});
