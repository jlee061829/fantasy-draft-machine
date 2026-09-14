import { randomUUID } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { prisma } from "../client.js";
import {
  cleanupLeagueTestData,
  createTestBotMember,
  createTestPlayer,
  createTestUser,
} from "../test-support/db.js";
import type { ScoringFormat } from "../generated/prisma/client.js";
import type { BotStrategy } from "@fdm/shared";
import { selectPositionAwareBotPlayerId } from "./position-aware-selection.js";

async function createDraftContext(
  scoringFormat: ScoringFormat = "PPR",
  overrides: Partial<{ rosterSize: number; teamCount: number; botStrategy: BotStrategy }> = {},
) {
  const owner = await createTestUser();
  const league = await prisma.league.create({
    data: {
      name: "Position-Aware Selection Test League",
      ownerId: owner.id,
      rosterSize: overrides.rosterSize ?? 15,
      teamCount: overrides.teamCount ?? 4,
      inviteCode: randomUUID().replace(/-/g, "").slice(0, 8).toUpperCase(),
      timerSeconds: 60,
      scoringFormat,
      draftType: "SNAKE",
    },
  });
  const bot = await createTestBotMember(league.id, 1, { botStrategy: overrides.botStrategy ?? "BALANCED" });
  const draft = await prisma.draft.create({
    data: { leagueId: league.id, status: "ACTIVE", currentPickNumber: 1, currentMemberId: bot.id },
  });
  return { league, bot, draft };
}

function pickNumberForRound(round: number, teamCount: number): number {
  return (round - 1) * teamCount + 1;
}

async function createRosteredPlayer(
  overrides: Partial<{
    fullName: string;
    position: string;
    searchRank: number | null;
    nflTeam: string | null;
  }> = {},
) {
  return createTestPlayer({ nflTeam: "KC", position: "RB", ...overrides });
}

async function addAdp(playerId: string, format: ScoringFormat, adp: number | null) {
  return prisma.playerAdp.create({ data: { playerId, format, adp, source: "test" } });
}

async function draftPlayer(draftId: string, leagueMemberId: string, playerId: string, pickNumber: number) {
  return prisma.pick.create({ data: { draftId, leagueMemberId, playerId, pickNumber } });
}

async function select(
  draftId: string,
  leagueMemberId: string,
  scoringFormat: ScoringFormat,
  overrides: Partial<{
    rosterSize: number;
    currentPickNumber: number;
    teamCount: number;
    botStrategy: BotStrategy;
  }> = {},
) {
  const rosterSize = overrides.rosterSize ?? 15;
  const teamCount = overrides.teamCount ?? 4;
  const currentPickNumber = overrides.currentPickNumber ?? 1;
  const botStrategy = overrides.botStrategy ?? "BALANCED";
  return prisma.$transaction((tx) =>
    selectPositionAwareBotPlayerId(tx, {
      draftId,
      leagueMemberId,
      scoringFormat,
      rosterSize,
      currentPickNumber,
      teamCount,
      botStrategy,
    }),
  );
}

// startingPickNumber defaults to 1 for tests that only ever give one
// position to one bot; tests that build up a multi-position roster on the
// same bot/draft (the feasibility-integration tests below) must pass
// explicit non-overlapping ranges themselves — pickNumber is unique per
// draft (@@unique([draftId, pickNumber])).
async function giveBotPositionCount(
  draftId: string,
  leagueMemberId: string,
  position: string,
  count: number,
  startingPickNumber = 1,
) {
  for (let i = 0; i < count; i++) {
    const player = await createRosteredPlayer({ position, fullName: `Owned ${position} ${i}` });
    await draftPlayer(draftId, leagueMemberId, player.id, startingPickNumber + i);
  }
}

// Drafts `count` distinct rostered players at `position` for the BOT, each
// with a real, deterministically-ranked PPR ADP so a subsequent
// getPositionalAdpRank call resolves a specific known rank rather than
// null. Returns the drafted players in rank order (best first).
async function giveBotRankedOwnedPlayer(
  draftId: string,
  leagueMemberId: string,
  position: string,
  pickNumber: number,
  adp: number,
) {
  const player = await createRosteredPlayer({ position, fullName: `Owned ${position} (adp ${adp})` });
  await addAdp(player.id, "PPR", adp);
  await draftPlayer(draftId, leagueMemberId, player.id, pickNumber);
  return player;
}

describe("selectPositionAwareBotPlayerId", () => {
  beforeEach(async () => {
    await cleanupLeagueTestData();
  });

  afterEach(async () => {
    await cleanupLeagueTestData();
  });

  describe("baseline (empty roster)", () => {
    it("behaves like raw ADP for ordinary candidates with no owned players", async () => {
      const { draft, bot, league } = await createDraftContext("PPR");
      const worse = await createRosteredPlayer({ fullName: "Worse", position: "WR" });
      await addAdp(worse.id, "PPR", 50);
      const better = await createRosteredPlayer({ fullName: "Better", position: "QB" });
      await addAdp(better.id, "PPR", 5);

      const result = await select(draft.id, bot.id, league.scoringFormat);

      expect(result).toBe(better.id);
    });
  });

  describe("QB soft penalty (owned 0 -> +0, owned 1 -> +18, before any onesie gating applies)", () => {
    it("owning one QB applies a moderate penalty a nearby non-QB can beat", async () => {
      const { draft, bot, league } = await createDraftContext("PPR");
      await giveBotPositionCount(draft.id, bot.id, "QB", 1);
      const wr = await createRosteredPlayer({ fullName: "WR candidate", position: "WR" });
      await addAdp(wr.id, "PPR", 41);
      const otherWr = await createRosteredPlayer({ fullName: "Other WR", position: "WR" });
      await addAdp(otherWr.id, "PPR", 42);

      const result = await select(draft.id, bot.id, league.scoringFormat);

      expect(result).toBe(wr.id);
    });
  });

  describe("TE soft penalty (owned 0 -> +0, owned 1 -> +15)", () => {
    it("owning one TE applies a moderate penalty a nearby WR can beat", async () => {
      const { draft, bot, league } = await createDraftContext("PPR");
      await giveBotPositionCount(draft.id, bot.id, "TE", 1);
      const te = await createRosteredPlayer({ fullName: "TE2 candidate", position: "TE" });
      await addAdp(te.id, "PPR", 40);
      const wr = await createRosteredPlayer({ fullName: "WR candidate", position: "WR" });
      await addAdp(wr.id, "PPR", 41);

      const result = await select(draft.id, bot.id, league.scoringFormat);

      expect(result).toBe(wr.id);
    });
  });

  describe("RB/WR depth (BALANCED bands, unchanged from Phase 5.5)", () => {
    it("normal RB depth (0-2 owned) remains unpenalized against an equal-ADP QB alternative", async () => {
      const { draft, bot, league } = await createDraftContext("PPR");
      await giveBotPositionCount(draft.id, bot.id, "RB", 2);
      const rb = await createRosteredPlayer({ fullName: "RB3 candidate", position: "RB" });
      await addAdp(rb.id, "PPR", 30);
      const qb = await createRosteredPlayer({ fullName: "QB candidate", position: "QB" });
      await addAdp(qb.id, "PPR", 31);

      const result = await select(draft.id, bot.id, league.scoringFormat);

      expect(result).toBe(rb.id);
    });

    it("deeper RB ownership (4+) receives only a small penalty", async () => {
      const { draft, bot, league } = await createDraftContext("PPR");
      await giveBotPositionCount(draft.id, bot.id, "RB", 4);
      const rb = await createRosteredPlayer({ fullName: "RB5 candidate", position: "RB" });
      await addAdp(rb.id, "PPR", 30);
      const wr = await createRosteredPlayer({ fullName: "WR candidate", position: "WR" });
      await addAdp(wr.id, "PPR", 41);

      const result = await select(draft.id, bot.id, league.scoringFormat);

      expect(result).toBe(wr.id);
    });

    it("a strong ADP value can overcome the small RB/WR depth penalty", async () => {
      const { draft, bot, league } = await createDraftContext("PPR");
      await giveBotPositionCount(draft.id, bot.id, "WR", 5);
      const wr = await createRosteredPlayer({ fullName: "Elite value WR6", position: "WR" });
      await addAdp(wr.id, "PPR", 10);
      const qb = await createRosteredPlayer({ fullName: "Ordinary QB", position: "QB" });
      await addAdp(qb.id, "PPR", 40);

      const result = await select(draft.id, bot.id, league.scoringFormat);

      expect(result).toBe(wr.id);
    });
  });

  // Phase 5.6: K<=1, DEF<=1, QB<=2, TE<=2 are hard eligibility filters, not
  // penalties — a duplicate is removed from the candidate pool entirely, so
  // a dramatically better raw ADP/searchRank on the duplicate must not
  // matter at all.
  describe("hard onesie caps (K/DEF/QB/TE) — exclusion, not penalty", () => {
    it("K: owned 0 is eligible; owned 1 excludes every further K candidate, even one with a dramatically better ADP", async () => {
      const { draft, bot, league } = await createDraftContext("PPR", { teamCount: 4 });
      const lateRound = pickNumberForRound(13, 4); // inside the late window, so timing can't explain exclusion
      await giveBotPositionCount(draft.id, bot.id, "K", 1);
      const k2 = await createRosteredPlayer({ fullName: "Elite value K2", position: "K" });
      await addAdp(k2.id, "PPR", 1);
      const rb = await createRosteredPlayer({ fullName: "Only real alternative", position: "RB" });
      await addAdp(rb.id, "PPR", 200);

      const result = await select(draft.id, bot.id, league.scoringFormat, { currentPickNumber: lateRound });

      expect(result).toBe(rb.id);
      expect(result).not.toBe(k2.id);
    });

    it("DEF: owned 1 excludes every further DEF candidate regardless of value", async () => {
      const { draft, bot, league } = await createDraftContext("PPR", { teamCount: 4 });
      const lateRound = pickNumberForRound(13, 4);
      await giveBotPositionCount(draft.id, bot.id, "DEF", 1);
      const def2 = await createRosteredPlayer({ fullName: "Elite value DEF2", position: "DEF" });
      await addAdp(def2.id, "PPR", 1);
      const rb = await createRosteredPlayer({ fullName: "Only real alternative", position: "RB" });
      await addAdp(rb.id, "PPR", 200);

      const result = await select(draft.id, bot.id, league.scoringFormat, { currentPickNumber: lateRound });

      expect(result).toBe(rb.id);
    });

    it("QB: owning two QBs excludes QB3 regardless of value", async () => {
      const { draft, bot, league } = await createDraftContext("PPR");
      await giveBotPositionCount(draft.id, bot.id, "QB", 2);
      const qb3 = await createRosteredPlayer({ fullName: "Elite value QB3", position: "QB" });
      await addAdp(qb3.id, "PPR", 1);
      const wr = await createRosteredPlayer({ fullName: "Ordinary WR", position: "WR" });
      await addAdp(wr.id, "PPR", 50);

      const result = await select(draft.id, bot.id, league.scoringFormat);

      expect(result).toBe(wr.id);
      expect(result).not.toBe(qb3.id);
    });

    it("TE: owning two TEs excludes TE3 regardless of value", async () => {
      const { draft, bot, league } = await createDraftContext("PPR");
      await giveBotPositionCount(draft.id, bot.id, "TE", 2);
      const te3 = await createRosteredPlayer({ fullName: "Elite value TE3", position: "TE" });
      await addAdp(te3.id, "PPR", 1);
      const rb = await createRosteredPlayer({ fullName: "Ordinary RB", position: "RB" });
      await addAdp(rb.id, "PPR", 50);

      const result = await select(draft.id, bot.id, league.scoringFormat);

      expect(result).toBe(rb.id);
    });
  });

  describe("elite QB backup gating", () => {
    it("elite QB1 (positional rank <= 8) forbids QB2 even deep into the backup window", async () => {
      const { draft, bot, league } = await createDraftContext("PPR", { rosterSize: 15, teamCount: 4 });
      // 7 better QBs (ranks 1-7) + the owned QB at rank 8 -> owned is elite.
      for (let i = 0; i < 7; i++) {
        await createRosteredPlayer({ position: "QB", fullName: `Filler elite QB ${i}` }).then((p) =>
          addAdp(p.id, "PPR", i + 1),
        );
      }
      await giveBotRankedOwnedPlayer(draft.id, bot.id, "QB", 1, 8);
      const qb2 = await createRosteredPlayer({ fullName: "QB2 candidate", position: "QB" });
      await addAdp(qb2.id, "PPR", 100);
      const wr = await createRosteredPlayer({ fullName: "WR candidate", position: "WR" });
      await addAdp(wr.id, "PPR", 101);

      const result = await select(draft.id, bot.id, league.scoringFormat, {
        currentPickNumber: pickNumberForRound(12, 4), // backup window is open (>= round 10)
      });

      expect(result).toBe(wr.id);
      expect(result).not.toBe(qb2.id);
    });

    it("non-elite QB1 (positional rank > 8), before the backup window: QB2 forbidden", async () => {
      const { draft, bot, league } = await createDraftContext("PPR", { rosterSize: 15, teamCount: 4 });
      for (let i = 0; i < 9; i++) {
        await createRosteredPlayer({ position: "QB", fullName: `Filler QB ${i}` }).then((p) =>
          addAdp(p.id, "PPR", i + 1),
        );
      }
      await giveBotRankedOwnedPlayer(draft.id, bot.id, "QB", 1, 10); // positional rank 10 -> non-elite
      const qb2 = await createRosteredPlayer({ fullName: "QB2 candidate", position: "QB" });
      await addAdp(qb2.id, "PPR", 100);
      const wr = await createRosteredPlayer({ fullName: "WR candidate", position: "WR" });
      await addAdp(wr.id, "PPR", 101);

      const result = await select(draft.id, bot.id, league.scoringFormat, {
        currentPickNumber: pickNumberForRound(8, 4), // before backupWindowStart=10
      });

      expect(result).toBe(wr.id);
      expect(result).not.toBe(qb2.id);
    });

    it("non-elite QB1, backup window open: QB2 eligible", async () => {
      const { draft, bot, league } = await createDraftContext("PPR", { rosterSize: 15, teamCount: 4 });
      // Positional rank is static (computed against the full rostered
      // population, not "remaining undrafted"), so the 9 better-ranked
      // fillers must exist as Player/PlayerAdp rows to establish the
      // owned QB's rank of 10 — but once that rank is established, they'd
      // also be onesie-eligible QB candidates in their own right (the
      // owned-QB gate applies to every QB candidate, not just a
      // "designated" one) and would trivially beat qb2 on raw ADP. Drafting
      // them away (to a second BOT in the same draft) removes them from
      // the undrafted candidate pool without affecting `bot`'s own
      // ownedCounts.
      const otherBot = await createTestBotMember(league.id, 2, { botStrategy: "BALANCED" });
      for (let i = 0; i < 9; i++) {
        const filler = await createRosteredPlayer({ position: "QB", fullName: `Filler QB ${i}` });
        await addAdp(filler.id, "PPR", i + 1);
        await draftPlayer(draft.id, otherBot.id, filler.id, i + 2); // picks 2-10
      }
      await giveBotRankedOwnedPlayer(draft.id, bot.id, "QB", 1, 10); // pick 1
      const qb2 = await createRosteredPlayer({ fullName: "QB2 candidate", position: "QB" });
      await addAdp(qb2.id, "PPR", 100);
      const wr = await createRosteredPlayer({ fullName: "Ordinary WR", position: "WR" });
      await addAdp(wr.id, "PPR", 200);

      const result = await select(draft.id, bot.id, league.scoringFormat, {
        currentPickNumber: pickNumberForRound(10, 4), // backupWindowStart
      });

      expect(result).toBe(qb2.id);
    });

    it("null-rank QB1 (no usable ADP), backup window open: QB2 eligible (treated as non-elite)", async () => {
      const { draft, bot, league } = await createDraftContext("PPR", { rosterSize: 15, teamCount: 4 });
      const ownedQb = await createRosteredPlayer({ position: "QB", fullName: "Owned QB, no ADP" });
      await draftPlayer(draft.id, bot.id, ownedQb.id, 1);
      const qb2 = await createRosteredPlayer({ fullName: "QB2 candidate", position: "QB" });
      await addAdp(qb2.id, "PPR", 100);
      const wr = await createRosteredPlayer({ fullName: "Ordinary WR", position: "WR" });
      await addAdp(wr.id, "PPR", 200);

      const result = await select(draft.id, bot.id, league.scoringFormat, {
        currentPickNumber: pickNumberForRound(10, 4),
      });

      expect(result).toBe(qb2.id);
    });
  });

  describe("elite TE backup gating", () => {
    it("elite TE1 (positional rank <= 5) forbids TE2 at any round", async () => {
      const { draft, bot, league } = await createDraftContext("PPR", { rosterSize: 15, teamCount: 4 });
      for (let i = 0; i < 4; i++) {
        await createRosteredPlayer({ position: "TE", fullName: `Filler elite TE ${i}` }).then((p) =>
          addAdp(p.id, "PPR", i + 1),
        );
      }
      await giveBotRankedOwnedPlayer(draft.id, bot.id, "TE", 1, 5);
      const te2 = await createRosteredPlayer({ fullName: "TE2 candidate", position: "TE" });
      await addAdp(te2.id, "PPR", 100);
      const rb = await createRosteredPlayer({ fullName: "RB candidate", position: "RB" });
      await addAdp(rb.id, "PPR", 101);

      const result = await select(draft.id, bot.id, league.scoringFormat, {
        currentPickNumber: pickNumberForRound(15, 4),
      });

      expect(result).toBe(rb.id);
      expect(result).not.toBe(te2.id);
    });

    it("non-elite TE1 (rank > 5), before the backup window: TE2 forbidden", async () => {
      const { draft, bot, league } = await createDraftContext("PPR", { rosterSize: 15, teamCount: 4 });
      for (let i = 0; i < 6; i++) {
        await createRosteredPlayer({ position: "TE", fullName: `Filler TE ${i}` }).then((p) =>
          addAdp(p.id, "PPR", i + 1),
        );
      }
      await giveBotRankedOwnedPlayer(draft.id, bot.id, "TE", 1, 7);
      const te2 = await createRosteredPlayer({ fullName: "TE2 candidate", position: "TE" });
      await addAdp(te2.id, "PPR", 100);
      const rb = await createRosteredPlayer({ fullName: "RB candidate", position: "RB" });
      await addAdp(rb.id, "PPR", 101);

      const result = await select(draft.id, bot.id, league.scoringFormat, {
        currentPickNumber: pickNumberForRound(8, 4),
      });

      expect(result).toBe(rb.id);
    });

    it("non-elite TE1, backup window open: TE2 eligible", async () => {
      const { draft, bot, league } = await createDraftContext("PPR", { rosterSize: 15, teamCount: 4 });
      // See the analogous QB test above for why the fillers must be
      // drafted away rather than left undrafted.
      const otherBot = await createTestBotMember(league.id, 2, { botStrategy: "BALANCED" });
      for (let i = 0; i < 6; i++) {
        const filler = await createRosteredPlayer({ position: "TE", fullName: `Filler TE ${i}` });
        await addAdp(filler.id, "PPR", i + 1);
        await draftPlayer(draft.id, otherBot.id, filler.id, i + 2); // picks 2-7
      }
      await giveBotRankedOwnedPlayer(draft.id, bot.id, "TE", 1, 7); // pick 1, positional rank 7
      const te2 = await createRosteredPlayer({ fullName: "TE2 candidate", position: "TE" });
      await addAdp(te2.id, "PPR", 100);
      const rb = await createRosteredPlayer({ fullName: "Ordinary RB", position: "RB" });
      await addAdp(rb.id, "PPR", 200);

      const result = await select(draft.id, bot.id, league.scoringFormat, {
        currentPickNumber: pickNumberForRound(11, 4),
      });

      expect(result).toBe(te2.id);
    });

    it("null-rank TE1, backup window open: TE2 eligible", async () => {
      const { draft, bot, league } = await createDraftContext("PPR", { rosterSize: 15, teamCount: 4 });
      const ownedTe = await createRosteredPlayer({ position: "TE", fullName: "Owned TE, no ADP" });
      await draftPlayer(draft.id, bot.id, ownedTe.id, 1);
      const te2 = await createRosteredPlayer({ fullName: "TE2 candidate", position: "TE" });
      await addAdp(te2.id, "PPR", 100);
      const rb = await createRosteredPlayer({ fullName: "Ordinary RB", position: "RB" });
      await addAdp(rb.id, "PPR", 200);

      const result = await select(draft.id, bot.id, league.scoringFormat, {
        currentPickNumber: pickNumberForRound(11, 4),
      });

      expect(result).toBe(te2.id);
    });
  });

  describe("ownership scoping", () => {
    it("only counts the current BOT's own Picks toward its position penalties/caps", async () => {
      const { draft, bot, league } = await createDraftContext("PPR");
      const otherBot = await createTestBotMember(league.id, 2, { botStrategy: "BALANCED" });
      await giveBotPositionCount(draft.id, otherBot.id, "QB", 3);
      const qb = await createRosteredPlayer({ fullName: "QB candidate", position: "QB" });
      await addAdp(qb.id, "PPR", 20);
      const wr = await createRosteredPlayer({ fullName: "WR candidate", position: "WR" });
      await addAdp(wr.id, "PPR", 21);

      const result = await select(draft.id, bot.id, league.scoringFormat);

      expect(result).toBe(qb.id);
    });

    it("ownership is keyed by leagueMemberId, not any user identity", async () => {
      const { draft, bot, league } = await createDraftContext("PPR");
      expect(bot.userId).toBeNull();
      await giveBotPositionCount(draft.id, bot.id, "TE", 2);

      const te = await createRosteredPlayer({ fullName: "TE candidate", position: "TE" });
      await addAdp(te.id, "PPR", 40);
      const rb = await createRosteredPlayer({ fullName: "RB candidate", position: "RB" });
      await addAdp(rb.id, "PPR", 42);

      const result = await select(draft.id, bot.id, league.scoringFormat);

      expect(result).toBe(rb.id);
    });
  });

  describe("candidate correctness", () => {
    it("selects a different winner when scoring format changes ADP", async () => {
      const { draft, bot } = await createDraftContext("PPR");
      const playerA = await createRosteredPlayer({ fullName: "A" });
      await addAdp(playerA.id, "STANDARD", 5);
      await addAdp(playerA.id, "PPR", 50);
      const playerB = await createRosteredPlayer({ fullName: "B" });
      await addAdp(playerB.id, "STANDARD", 50);
      await addAdp(playerB.id, "PPR", 5);

      expect(await select(draft.id, bot.id, "STANDARD")).toBe(playerA.id);
      expect(await select(draft.id, bot.id, "PPR")).toBe(playerB.id);
    });

    it("excludes a player already drafted in this draft", async () => {
      const { draft, bot, league } = await createDraftContext("PPR");
      const taken = await createRosteredPlayer({ fullName: "Taken" });
      await addAdp(taken.id, "PPR", 1);
      const nextBest = await createRosteredPlayer({ fullName: "Next Best" });
      await addAdp(nextBest.id, "PPR", 2);
      await draftPlayer(draft.id, bot.id, taken.id, 1);

      const result = await select(draft.id, bot.id, league.scoringFormat);

      expect(result).toBe(nextBest.id);
    });

    it("keeps a player eligible if drafted only in a different draft", async () => {
      const { draft, bot, league } = await createDraftContext("PPR");
      const other = await createDraftContext("PPR");
      const player = await createRosteredPlayer();
      await addAdp(player.id, "PPR", 1);
      await draftPlayer(other.draft.id, other.bot.id, player.id, 1);

      const result = await select(draft.id, bot.id, league.scoringFormat);

      expect(result).toBe(player.id);
    });

    it("excludes a non-rostered (nflTeam: null) player even with the best ADP", async () => {
      const { draft, bot, league } = await createDraftContext("PPR");
      const nonRostered = await createRosteredPlayer({ nflTeam: null, fullName: "Practice Squad" });
      await addAdp(nonRostered.id, "PPR", 1);
      const rostered = await createRosteredPlayer({ fullName: "Rostered Worse ADP" });
      await addAdp(rostered.id, "PPR", 50);

      const result = await select(draft.id, bot.id, league.scoringFormat);

      expect(result).toBe(rostered.id);
    });

    it("tier 1 (has ADP) always outranks tier 2 (no ADP)", async () => {
      const { draft, bot, league } = await createDraftContext("PPR");
      const withAdp = await createRosteredPlayer({ fullName: "Has ADP", position: "WR" });
      await addAdp(withAdp.id, "PPR", 180);
      const noAdp = await createRosteredPlayer({ fullName: "No ADP", position: "WR", searchRank: 1 });

      const result = await select(draft.id, bot.id, league.scoringFormat);

      expect(result).toBe(withAdp.id);
      expect(result).not.toBe(noAdp.id);
    });

    it("within tier 2, a real searchRank beats a null searchRank", async () => {
      const { draft, bot, league } = await createDraftContext("PPR");
      const nullRank = await createRosteredPlayer({ fullName: "Null Rank", searchRank: null });
      const realRank = await createRosteredPlayer({ fullName: "Real Rank", searchRank: 500 });

      const result = await select(draft.id, bot.id, league.scoringFormat);

      expect(result).toBe(realRank.id);
      expect(result).not.toBe(nullRank.id);
    });

    it("deterministically breaks a tied null-searchRank tier-2 case by player id", async () => {
      const { draft, bot, league } = await createDraftContext("PPR");
      const playerA = await createRosteredPlayer({ fullName: "A", searchRank: null });
      const playerB = await createRosteredPlayer({ fullName: "B", searchRank: null });
      const expected = [playerA.id, playerB.id].sort()[0];

      const result = await select(draft.id, bot.id, league.scoringFormat);

      expect(result).toBe(expected);
    });

    it("returns null when no eligible undrafted rostered player exists", async () => {
      const { draft, bot, league } = await createDraftContext("PPR");

      const result = await select(draft.id, bot.id, league.scoringFormat);

      expect(result).toBeNull();
    });

    it("returns the same result on repeated calls against unchanged state", async () => {
      const { draft, bot, league } = await createDraftContext("PPR");
      await giveBotPositionCount(draft.id, bot.id, "QB", 1);
      const player = await createRosteredPlayer({ position: "WR" });
      await addAdp(player.id, "PPR", 10);

      const first = await select(draft.id, bot.id, league.scoringFormat);
      const second = await select(draft.id, bot.id, league.scoringFormat);

      expect(first).toBe(player.id);
      expect(second).toBe(player.id);
    });
  });

  describe("K/DEF timing penalty (round 12/13 boundary, first K/DEF only)", () => {
    for (const position of ["K", "DEF"] as const) {
      it(`${position}: round 12 — a nearby non-K/DEF candidate beats it due to the +100 timing penalty`, async () => {
        const { draft, bot, league } = await createDraftContext("PPR");
        const round12Pick = pickNumberForRound(12, league.teamCount);
        const target = await createRosteredPlayer({ fullName: `${position} candidate`, position });
        await addAdp(target.id, "PPR", 40);
        const rb = await createRosteredPlayer({ fullName: "RB candidate", position: "RB" });
        await addAdp(rb.id, "PPR", 45);

        const result = await select(draft.id, bot.id, league.scoringFormat, {
          rosterSize: league.rosterSize,
          teamCount: league.teamCount,
          currentPickNumber: round12Pick,
        });

        expect(result).toBe(rb.id);
      });

      it(`${position}: round 13 — the timing penalty is removed and it wins on raw score`, async () => {
        const { draft, bot, league } = await createDraftContext("PPR");
        const round13Pick = pickNumberForRound(13, league.teamCount);
        const target = await createRosteredPlayer({ fullName: `${position} candidate`, position });
        await addAdp(target.id, "PPR", 40);
        const rb = await createRosteredPlayer({ fullName: "RB candidate", position: "RB" });
        await addAdp(rb.id, "PPR", 45);

        const result = await select(draft.id, bot.id, league.scoringFormat, {
          rosterSize: league.rosterSize,
          teamCount: league.teamCount,
          currentPickNumber: round13Pick,
        });

        expect(result).toBe(target.id);
      });
    }
  });

  describe("K/DEF timing is a soft penalty, not an absolute exclusion", () => {
    it("an extreme value gap can still make an early K/DEF pick win despite the +100 timing penalty", async () => {
      const { draft, bot, league } = await createDraftContext("PPR");
      const round1Pick = pickNumberForRound(1, league.teamCount);
      const k = await createRosteredPlayer({ fullName: "Elite value K", position: "K" });
      await addAdp(k.id, "PPR", 5);
      const rb = await createRosteredPlayer({ fullName: "Only alternative", position: "RB" });
      await addAdp(rb.id, "PPR", 200);

      const result = await select(draft.id, bot.id, league.scoringFormat, {
        rosterSize: league.rosterSize,
        teamCount: league.teamCount,
        currentPickNumber: round1Pick,
      });

      expect(result).toBe(k.id);
    });
  });

  describe("strategy differentiation", () => {
    it("RB_HEAVY tolerates a 5th RB (BALANCED would already be penalizing at 4+)", async () => {
      const { draft, bot, league } = await createDraftContext("PPR", { botStrategy: "RB_HEAVY" });
      await giveBotPositionCount(draft.id, bot.id, "RB", 4);
      const rb = await createRosteredPlayer({ fullName: "RB5 candidate", position: "RB" });
      await addAdp(rb.id, "PPR", 30);
      const wr = await createRosteredPlayer({ fullName: "WR candidate", position: "WR" });
      await addAdp(wr.id, "PPR", 31);

      const result = await select(draft.id, bot.id, league.scoringFormat, { botStrategy: "RB_HEAVY" });

      expect(result).toBe(rb.id);
    });

    it("WR_HEAVY tolerates a 5th WR the same way", async () => {
      const { draft, bot, league } = await createDraftContext("PPR", { botStrategy: "WR_HEAVY" });
      await giveBotPositionCount(draft.id, bot.id, "WR", 4);
      const wr = await createRosteredPlayer({ fullName: "WR5 candidate", position: "WR" });
      await addAdp(wr.id, "PPR", 30);
      const rb = await createRosteredPlayer({ fullName: "RB candidate", position: "RB" });
      await addAdp(rb.id, "PPR", 31);

      const result = await select(draft.id, bot.id, league.scoringFormat, { botStrategy: "WR_HEAVY" });

      expect(result).toBe(wr.id);
    });

    it("HERO_RB sharply discourages an immediate second RB, unlike BALANCED", async () => {
      const { draft, bot, league } = await createDraftContext("PPR", { botStrategy: "HERO_RB" });
      await giveBotPositionCount(draft.id, bot.id, "RB", 1);
      const rb2 = await createRosteredPlayer({ fullName: "RB2 candidate", position: "RB" });
      await addAdp(rb2.id, "PPR", 30);
      const wr = await createRosteredPlayer({ fullName: "WR candidate", position: "WR" });
      await addAdp(wr.id, "PPR", 40); // BALANCED's +0 at 1-owned would keep RB2 (30<40); HERO_RB's +25 flips it (55>40)

      const result = await select(draft.id, bot.id, league.scoringFormat, { botStrategy: "HERO_RB" });

      expect(result).toBe(wr.id);
    });
  });

  describe("starting-lineup feasibility integration", () => {
    it("forces a still-missing required position over an otherwise-preferred bench pick", async () => {
      const { draft, bot, league } = await createDraftContext("PPR", { rosterSize: 15, teamCount: 4 });
      // Roster shape matching the frozen worked example: RB/WR surplus
      // already covers FLEX, so exactly QB/K/DEF are missing.
      await giveBotPositionCount(draft.id, bot.id, "RB", 5, 1); // picks 1-5
      await giveBotPositionCount(draft.id, bot.id, "WR", 4, 6); // picks 6-9
      await giveBotPositionCount(draft.id, bot.id, "TE", 1, 10); // pick 10
      // total RB now 7, total picks made = 12 (3 remaining of 15).
      await giveBotPositionCount(draft.id, bot.id, "RB", 2, 11); // picks 11-12
      const qb = await createRosteredPlayer({ fullName: "Needed QB", position: "QB" });
      await addAdp(qb.id, "PPR", 100);
      const rb = await createRosteredPlayer({ fullName: "Tempting RB", position: "RB" });
      await addAdp(rb.id, "PPR", 5); // far better raw value, but infeasible

      const result = await select(draft.id, bot.id, league.scoringFormat, {
        currentPickNumber: 49, // round 13 of 4-team league; 3 picks remain for this bot
      });

      expect(result).toBe(qb.id);
      expect(result).not.toBe(rb.id);
    });

    it("backup QB/TE selection must not consume a pick still needed for an unfilled starter", async () => {
      const { draft, bot, league } = await createDraftContext("PPR", { rosterSize: 15, teamCount: 4 });
      // BOT owns exactly 1 non-elite QB and nothing else; 1 pick remains.
      // The backup window is open, but taking QB2 would leave 0 picks for
      // the still-missing TE/K/DEF/FLEX obligations.
      for (let i = 0; i < 9; i++) {
        await createRosteredPlayer({ position: "QB", fullName: `Filler QB ${i}` }).then((p) =>
          addAdp(p.id, "PPR", i + 1),
        );
      }
      await giveBotRankedOwnedPlayer(draft.id, bot.id, "QB", 1, 10); // pick 1
      await giveBotPositionCount(draft.id, bot.id, "RB", 2, 2); // picks 2-3
      await giveBotPositionCount(draft.id, bot.id, "WR", 2, 4); // picks 4-5
      await giveBotPositionCount(draft.id, bot.id, "TE", 1, 6); // pick 6
      await giveBotPositionCount(draft.id, bot.id, "K", 1, 7); // pick 7
      // Pad with harmless extra RB depth so 14 total picks are made (1
      // remaining of 15): RB now 2+7=9, total picks = 1+2+2+1+1+7=14.
      await giveBotPositionCount(draft.id, bot.id, "RB", 7, 8); // picks 8-14
      const qb2 = await createRosteredPlayer({ fullName: "QB2 candidate", position: "QB" });
      await addAdp(qb2.id, "PPR", 100);
      const def = await createRosteredPlayer({ fullName: "Needed DEF", position: "DEF" });
      await addAdp(def.id, "PPR", 200);

      const result = await select(draft.id, bot.id, league.scoringFormat, {
        currentPickNumber: pickNumberForRound(15, 4), // deep in the backup window
      });

      expect(result).toBe(def.id);
      expect(result).not.toBe(qb2.id);
    });
  });

  describe("small-roster fallback (rosterSize < 9): lineup feasibility bypassed, never deadlocks", () => {
    it("continues ordinary strategy scoring instead of throwing when the fixed lineup cannot mathematically fit", async () => {
      const { draft, bot, league } = await createDraftContext("PPR", { rosterSize: 6, teamCount: 4 });
      // Roster has no QB/K/DEF and only 0 picks remain after this one (6
      // total picks, 5 already made) — under normal feasibility math this
      // would be hopelessly infeasible for several positions at once, but
      // rosterSize(6) < STARTING_LINEUP_TOTAL(9) bypasses feasibility
      // entirely, so an ordinary strategy pick (not a forced QB/K/DEF) must
      // still be selectable with no error.
      await giveBotPositionCount(draft.id, bot.id, "RB", 5);
      const wr = await createRosteredPlayer({ fullName: "Ordinary WR", position: "WR" });
      await addAdp(wr.id, "PPR", 10);

      const result = await select(draft.id, bot.id, league.scoringFormat, {
        rosterSize: 6,
        currentPickNumber: pickNumberForRound(6, 4),
      });

      expect(result).toBe(wr.id);
    });

    it("hard onesie caps still apply even when feasibility is bypassed", async () => {
      const { draft, bot, league } = await createDraftContext("PPR", { rosterSize: 6, teamCount: 4 });
      await giveBotPositionCount(draft.id, bot.id, "K", 1);
      const k2 = await createRosteredPlayer({ fullName: "Elite value K2", position: "K" });
      await addAdp(k2.id, "PPR", 1);
      const rb = await createRosteredPlayer({ fullName: "Only alternative", position: "RB" });
      await addAdp(rb.id, "PPR", 200);

      const result = await select(draft.id, bot.id, league.scoringFormat, {
        rosterSize: 6,
        currentPickNumber: pickNumberForRound(6, 4),
      });

      expect(result).toBe(rb.id);
    });
  });

  describe("impossible-lineup fallback (feasibility empties the pool, but onesie-eligible candidates remain)", () => {
    it("falls back to the full onesie-eligible set rather than returning null", async () => {
      const { draft, bot, league } = await createDraftContext("PPR", { rosterSize: 15, teamCount: 4 });
      // 1 pick remains; missing QB, K, and DEF (3 slots) — mathematically
      // impossible for a single remaining pick to satisfy all three. No
      // real QB/K/DEF candidate exists in the pool at all (simulating
      // total supply exhaustion for those positions) — only RB/WR remain.
      await giveBotPositionCount(draft.id, bot.id, "RB", 5, 1); // picks 1-5
      await giveBotPositionCount(draft.id, bot.id, "WR", 4, 6); // picks 6-9
      await giveBotPositionCount(draft.id, bot.id, "TE", 1, 10); // pick 10
      await giveBotPositionCount(draft.id, bot.id, "RB", 4, 11); // picks 11-14; total picks made = 14, RB=9
      const onlyOption = await createRosteredPlayer({ fullName: "Only remaining player", position: "WR" });
      await addAdp(onlyOption.id, "PPR", 10);

      const result = await select(draft.id, bot.id, league.scoringFormat, {
        currentPickNumber: pickNumberForRound(15, 4),
      });

      expect(result).toBe(onlyOption.id);
    });
  });
});
