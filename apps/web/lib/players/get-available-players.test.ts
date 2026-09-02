import { cleanupLeagueTestData, createTestPlayer } from "@fdm/database/test-support";
import { prisma } from "@fdm/database";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { getAvailablePlayers, type AvailablePlayer } from "./get-available-players";

// getAvailablePlayers returns a GLOBAL player pool, not league-scoped data —
// unlike every other integration test in this repo, cleanupLeagueTestData's
// player.deleteMany() is the only thing that can be relied on for
// isolation, and even that is shared with whatever ran immediately before
// this file in the same serial test run (fileParallelism: false). So rather
// than asserting exact array length/equality on the full result, every test
// below locates its own fixtures by id within the returned array and
// asserts only their relative inclusion/exclusion/ordering — see CLAUDE.md's
// isolation guidance for this exact scenario.
async function createRosteredPlayerWithAdp(
  format: "STANDARD" | "PPR" | "HALF_PPR",
  adp: number | null,
  overrides: Partial<{ fullName: string; position: string; nflTeam: string; searchRank: number | null }> = {},
) {
  const player = await createTestPlayer({
    fullName: overrides.fullName,
    position: overrides.position,
    searchRank: overrides.searchRank,
    nflTeam: overrides.nflTeam ?? "CIN",
  });
  await prisma.playerAdp.create({
    data: { playerId: player.id, format, adp, source: "test" },
  });
  return player;
}

function find(players: AvailablePlayer[], id: string): AvailablePlayer | undefined {
  return players.find((p) => p.id === id);
}

function indexOf(players: AvailablePlayer[], id: string): number {
  return players.findIndex((p) => p.id === id);
}

describe("getAvailablePlayers", () => {
  beforeEach(async () => {
    await cleanupLeagueTestData();
  });

  afterEach(async () => {
    await cleanupLeagueTestData();
  });

  it("selects the ADP for the requested scoring format, ignoring the other formats", async () => {
    const player = await createTestPlayer({ fullName: "Format Player", nflTeam: "CIN" });
    await prisma.playerAdp.create({
      data: { playerId: player.id, format: "PPR", adp: 5, source: "test" },
    });
    await prisma.playerAdp.create({
      data: { playerId: player.id, format: "STANDARD", adp: 50, source: "test" },
    });
    await prisma.playerAdp.create({
      data: { playerId: player.id, format: "HALF_PPR", adp: 25, source: "test" },
    });

    const ppr = await getAvailablePlayers("PPR");
    const standard = await getAvailablePlayers("STANDARD");
    const halfPpr = await getAvailablePlayers("HALF_PPR");

    expect(find(ppr, player.id)?.adp).toBe(5);
    expect(find(standard, player.id)?.adp).toBe(50);
    expect(find(halfPpr, player.id)?.adp).toBe(25);
  });

  it("includes rostered players (nflTeam set)", async () => {
    const rostered = await createRosteredPlayerWithAdp("PPR", 10, { fullName: "Rostered Player" });

    const result = await getAvailablePlayers("PPR");

    expect(find(result, rostered.id)).toBeDefined();
    expect(find(result, rostered.id)?.nflTeam).toBe("CIN");
  });

  it("excludes players with no current NFL team", async () => {
    const freeAgent = await createTestPlayer({ fullName: "Free Agent", nflTeam: null });
    await prisma.playerAdp.create({
      data: { playerId: freeAgent.id, format: "PPR", adp: 1, source: "test" },
    });

    const result = await getAvailablePlayers("PPR");

    expect(find(result, freeAgent.id)).toBeUndefined();
  });

  it("represents a missing ADP as null rather than omitting the player", async () => {
    const noAdp = await createRosteredPlayerWithAdp("PPR", null, { fullName: "No ADP Player" });

    const result = await getAvailablePlayers("PPR");

    const entry = find(result, noAdp.id);
    expect(entry).toBeDefined();
    expect(entry?.adp).toBeNull();
  });

  it("orders players with real ADP ascending, before any ADP-less player", async () => {
    const worse = await createRosteredPlayerWithAdp("PPR", 50, { fullName: "Worse ADP" });
    const better = await createRosteredPlayerWithAdp("PPR", 5, { fullName: "Better ADP" });
    const noAdp = await createRosteredPlayerWithAdp("PPR", null, { fullName: "No ADP" });

    const result = await getAvailablePlayers("PPR");

    expect(indexOf(result, better.id)).toBeLessThan(indexOf(result, worse.id));
    expect(indexOf(result, worse.id)).toBeLessThan(indexOf(result, noAdp.id));
  });

  it("falls back to searchRank ascending (nulls last) among ADP-less players", async () => {
    const betterRank = await createRosteredPlayerWithAdp("PPR", null, {
      fullName: "Better Rank",
      searchRank: 10,
    });
    const worseRank = await createRosteredPlayerWithAdp("PPR", null, {
      fullName: "Worse Rank",
      searchRank: 200,
    });
    const noRank = await createRosteredPlayerWithAdp("PPR", null, {
      fullName: "No Rank At All",
      searchRank: null,
    });

    const result = await getAvailablePlayers("PPR");

    expect(indexOf(result, betterRank.id)).toBeLessThan(indexOf(result, worseRank.id));
    expect(indexOf(result, worseRank.id)).toBeLessThan(indexOf(result, noRank.id));
  });
});
