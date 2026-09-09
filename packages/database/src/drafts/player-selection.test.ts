import { randomUUID } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { prisma } from "../client.js";
import { cleanupLeagueTestData, createTestPlayer, createTestUser } from "../test-support/db.js";
import type { ScoringFormat } from "../generated/prisma/client.js";
import { selectBestAvailablePlayerId } from "./player-selection.js";

// Minimal draft context: just enough real League/LeagueMember/Draft rows to
// have a valid draftId to scope selection/exclusion queries against, and a
// LeagueMember to attribute fixture Picks to. selectBestAvailablePlayerId
// itself never reads League/LeagueMember — this fixture exists only to
// satisfy Pick's required FKs (Pick.draftId -> Draft, Pick.leagueMemberId ->
// LeagueMember).
async function createDraftContext(scoringFormat: ScoringFormat = "PPR") {
  const owner = await createTestUser();
  const league = await prisma.league.create({
    data: {
      name: "Player Selection Test League",
      ownerId: owner.id,
      rosterSize: 8,
      teamCount: 4,
      inviteCode: randomUUID().replace(/-/g, "").slice(0, 8).toUpperCase(),
      timerSeconds: 60,
      scoringFormat,
      draftType: "SNAKE",
    },
  });
  const member = await prisma.leagueMember.create({
    data: { leagueId: league.id, userId: owner.id, draftSlot: 1 },
  });
  const draft = await prisma.draft.create({
    data: { leagueId: league.id, status: "ACTIVE", currentPickNumber: 1, currentMemberId: member.id },
  });
  return { league, member, draft };
}

// Test players default to rostered (nflTeam set) since that's the eligible
// shape for automated selection as of Phase 5.2 — tests that specifically
// need a non-rostered player pass `nflTeam: null` explicitly.
async function createRosteredPlayer(
  overrides: Partial<{ fullName: string; position: string; searchRank: number | null; nflTeam: string | null }> = {},
) {
  return createTestPlayer({ nflTeam: "KC", ...overrides });
}

async function addAdp(playerId: string, format: ScoringFormat, adp: number | null) {
  return prisma.playerAdp.create({ data: { playerId, format, adp, source: "test" } });
}

async function draftPlayer(draftId: string, leagueMemberId: string, playerId: string, pickNumber: number) {
  return prisma.pick.create({ data: { draftId, leagueMemberId, playerId, pickNumber } });
}

async function select(draftId: string, scoringFormat: ScoringFormat) {
  return prisma.$transaction((tx) => selectBestAvailablePlayerId(tx, { draftId, scoringFormat }));
}

describe("selectBestAvailablePlayerId", () => {
  beforeEach(async () => {
    await cleanupLeagueTestData();
  });

  afterEach(async () => {
    await cleanupLeagueTestData();
  });

  describe("eligibility", () => {
    it("selects a rostered player with an ADP", async () => {
      const { draft, league } = await createDraftContext("PPR");
      const player = await createRosteredPlayer();
      await addAdp(player.id, "PPR", 10);

      const result = await select(draft.id, league.scoringFormat);

      expect(result).toBe(player.id);
    });

    it("excludes a non-rostered (nflTeam: null) player even with the best ADP", async () => {
      const { draft, league } = await createDraftContext("PPR");
      const nonRostered = await createRosteredPlayer({ nflTeam: null, fullName: "Practice Squad" });
      await addAdp(nonRostered.id, "PPR", 1);
      const rostered = await createRosteredPlayer({ fullName: "Rostered Worse ADP" });
      await addAdp(rostered.id, "PPR", 50);

      const result = await select(draft.id, league.scoringFormat);

      expect(result).toBe(rostered.id);
      expect(result).not.toBe(nonRostered.id);
    });

    it("returns null when the only candidate is non-rostered", async () => {
      const { draft, league } = await createDraftContext("PPR");
      const nonRostered = await createRosteredPlayer({ nflTeam: null });
      await addAdp(nonRostered.id, "PPR", 1);

      const result = await select(draft.id, league.scoringFormat);

      expect(result).toBeNull();
    });

    it("excludes a player already drafted in the same draft", async () => {
      const { draft, league, member } = await createDraftContext("PPR");
      const taken = await createRosteredPlayer({ fullName: "Taken" });
      await addAdp(taken.id, "PPR", 1);
      const nextBest = await createRosteredPlayer({ fullName: "Next Best" });
      await addAdp(nextBest.id, "PPR", 2);
      await draftPlayer(draft.id, member.id, taken.id, 1);

      const result = await select(draft.id, league.scoringFormat);

      expect(result).toBe(nextBest.id);
    });

    it("keeps a player eligible if they were drafted only in a different draft", async () => {
      const { draft, league, member } = await createDraftContext("PPR");
      const other = await createDraftContext("PPR");
      const player = await createRosteredPlayer();
      await addAdp(player.id, "PPR", 1);
      await draftPlayer(other.draft.id, other.member.id, player.id, 1);

      const result = await select(draft.id, league.scoringFormat);

      expect(result).toBe(player.id);
    });
  });

  describe("ADP tier", () => {
    it("selects the lowest ADP among eligible candidates", async () => {
      const { draft, league } = await createDraftContext("PPR");
      const worse = await createRosteredPlayer({ fullName: "Worse" });
      await addAdp(worse.id, "PPR", 50);
      const better = await createRosteredPlayer({ fullName: "Better" });
      await addAdp(better.id, "PPR", 5);

      const result = await select(draft.id, league.scoringFormat);

      expect(result).toBe(better.id);
    });

    it("selects a different winner when scoring format changes ADP", async () => {
      const { draft } = await createDraftContext("PPR");
      const playerA = await createRosteredPlayer({ fullName: "A" });
      await addAdp(playerA.id, "STANDARD", 5);
      await addAdp(playerA.id, "PPR", 50);
      const playerB = await createRosteredPlayer({ fullName: "B" });
      await addAdp(playerB.id, "STANDARD", 50);
      await addAdp(playerB.id, "PPR", 5);

      expect(await select(draft.id, "STANDARD")).toBe(playerA.id);
      expect(await select(draft.id, "PPR")).toBe(playerB.id);
    });

    it("prefers any non-null ADP over a player with no ADP row, regardless of searchRank", async () => {
      const { draft, league } = await createDraftContext("PPR");
      const hasAdp = await createRosteredPlayer({ fullName: "Has ADP", searchRank: 500 });
      await addAdp(hasAdp.id, "PPR", 100);
      const noAdpGreatRank = await createRosteredPlayer({ fullName: "No ADP", searchRank: 1 });

      const result = await select(draft.id, league.scoringFormat);

      expect(result).toBe(hasAdp.id);
    });
  });

  describe("deterministic ADP-tier tiebreaks", () => {
    it("breaks a tied ADP by lower searchRank", async () => {
      const { draft, league } = await createDraftContext("PPR");
      const worseRank = await createRosteredPlayer({ fullName: "Worse Rank", searchRank: 200 });
      await addAdp(worseRank.id, "PPR", 10);
      const betterRank = await createRosteredPlayer({ fullName: "Better Rank", searchRank: 10 });
      await addAdp(betterRank.id, "PPR", 10);

      const result = await select(draft.id, league.scoringFormat);

      expect(result).toBe(betterRank.id);
    });

    it("breaks a tied ADP where one searchRank is null in favor of the non-null searchRank", async () => {
      const { draft, league } = await createDraftContext("PPR");
      const nullRank = await createRosteredPlayer({ fullName: "Null Rank", searchRank: null });
      await addAdp(nullRank.id, "PPR", 10);
      const realRank = await createRosteredPlayer({ fullName: "Real Rank", searchRank: 50 });
      await addAdp(realRank.id, "PPR", 10);

      const result = await select(draft.id, league.scoringFormat);

      expect(result).toBe(realRank.id);
    });

    it("breaks a tied ADP and tied searchRank by lower player id", async () => {
      const { draft, league } = await createDraftContext("PPR");
      const playerA = await createRosteredPlayer({ fullName: "A", searchRank: 10 });
      await addAdp(playerA.id, "PPR", 10);
      const playerB = await createRosteredPlayer({ fullName: "B", searchRank: 10 });
      await addAdp(playerB.id, "PPR", 10);
      const expected = [playerA.id, playerB.id].sort()[0];

      const result = await select(draft.id, league.scoringFormat);

      expect(result).toBe(expected);
    });
  });

  describe("fallback tier (no eligible ADP candidate)", () => {
    it("falls back to the lowest searchRank when no eligible player has a non-null ADP", async () => {
      const { draft, league } = await createDraftContext("PPR");
      const worseRank = await createRosteredPlayer({ fullName: "Worse Rank", searchRank: 200 });
      const betterRank = await createRosteredPlayer({ fullName: "Better Rank", searchRank: 10 });

      const result = await select(draft.id, league.scoringFormat);

      expect(result).toBe(betterRank.id);
      expect(result).not.toBe(worseRank.id);
    });

    it("breaks a tied fallback searchRank by lower player id", async () => {
      const { draft, league } = await createDraftContext("PPR");
      const playerA = await createRosteredPlayer({ fullName: "A", searchRank: 10 });
      const playerB = await createRosteredPlayer({ fullName: "B", searchRank: 10 });
      const expected = [playerA.id, playerB.id].sort()[0];

      const result = await select(draft.id, league.scoringFormat);

      expect(result).toBe(expected);
    });

    it("sorts a null fallback searchRank after any non-null searchRank", async () => {
      const { draft, league } = await createDraftContext("PPR");
      const nullRank = await createRosteredPlayer({ fullName: "Null Rank", searchRank: null });
      const realRank = await createRosteredPlayer({ fullName: "Real Rank", searchRank: 999 });

      const result = await select(draft.id, league.scoringFormat);

      expect(result).toBe(realRank.id);
      expect(result).not.toBe(nullRank.id);
    });

    it("breaks tied null fallback searchRanks by lower player id", async () => {
      const { draft, league } = await createDraftContext("PPR");
      const playerA = await createRosteredPlayer({ fullName: "A", searchRank: null });
      const playerB = await createRosteredPlayer({ fullName: "B", searchRank: null });
      const expected = [playerA.id, playerB.id].sort()[0];

      const result = await select(draft.id, league.scoringFormat);

      expect(result).toBe(expected);
    });
  });

  describe("exhaustion", () => {
    it("returns null when no eligible undrafted rostered player exists at all", async () => {
      const { draft, league } = await createDraftContext("PPR");

      const result = await select(draft.id, league.scoringFormat);

      expect(result).toBeNull();
    });
  });

  describe("determinism", () => {
    it("returns the same result on repeated calls against unchanged state", async () => {
      const { draft, league } = await createDraftContext("PPR");
      const player = await createRosteredPlayer();
      await addAdp(player.id, "PPR", 10);

      const first = await select(draft.id, league.scoringFormat);
      const second = await select(draft.id, league.scoringFormat);

      expect(first).toBe(player.id);
      expect(second).toBe(player.id);
    });
  });
});
