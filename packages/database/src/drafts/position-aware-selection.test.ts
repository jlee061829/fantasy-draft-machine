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
import { selectPositionAwareBotPlayerId } from "./position-aware-selection.js";

// Minimal draft context with a BOT LeagueMember whose roster the selector
// will score against. Mirrors player-selection.test.ts's
// createDraftContext, but the "member" this milestone cares about is
// specifically a BOT — position-aware selection is never called for a
// HUMAN turn (see autopick.test.ts's separation regression test).
async function createDraftContext(
  scoringFormat: ScoringFormat = "PPR",
  overrides: Partial<{ rosterSize: number; teamCount: number }> = {},
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
  const bot = await createTestBotMember(league.id, 1);
  const draft = await prisma.draft.create({
    data: { leagueId: league.id, status: "ACTIVE", currentPickNumber: 1, currentMemberId: bot.id },
  });
  return { league, bot, draft };
}

// First overall pickNumber of a given 1-indexed round, for a snake/linear
// draft with `teamCount` picks per round — used to place a select() call
// unambiguously inside a specific round for round-boundary tests.
function pickNumberForRound(round: number, teamCount: number): number {
  return (round - 1) * teamCount + 1;
}

// Test players default to rostered (nflTeam set) and RB (a position with no
// penalty at low ownership counts) since that's the neutral eligible shape
// most tests want; tests that care about a specific position override it.
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

// rosterSize/teamCount/currentPickNumber default to round 1 of a
// 15-round/4-team context (matching createDraftContext's own defaults) —
// an early/mid window pick, since lateWindowStart = max(1, 15-2) = 13. Only
// the round-aware K/DEF tests below override these.
async function select(
  draftId: string,
  leagueMemberId: string,
  scoringFormat: ScoringFormat,
  overrides: Partial<{ rosterSize: number; currentPickNumber: number; teamCount: number }> = {},
) {
  const rosterSize = overrides.rosterSize ?? 15;
  const teamCount = overrides.teamCount ?? 4;
  const currentPickNumber = overrides.currentPickNumber ?? 1;
  return prisma.$transaction((tx) =>
    selectPositionAwareBotPlayerId(tx, {
      draftId,
      leagueMemberId,
      scoringFormat,
      rosterSize,
      currentPickNumber,
      teamCount,
    }),
  );
}

// Gives a BOT `count` already-drafted Picks at the given position, at
// distinct earlier pickNumbers, so the selector's ownership count for that
// position is exactly `count` by the time the test calls select().
async function giveBotPositionCount(
  draftId: string,
  leagueMemberId: string,
  position: string,
  count: number,
) {
  for (let i = 0; i < count; i++) {
    const player = await createRosteredPlayer({ position, fullName: `Owned ${position} ${i}` });
    await draftPlayer(draftId, leagueMemberId, player.id, i + 1);
  }
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

  describe("QB", () => {
    it("owning one QB applies a moderate penalty that a nearby non-QB can beat", async () => {
      const { draft, bot, league } = await createDraftContext("PPR");
      await giveBotPositionCount(draft.id, bot.id, "QB", 1);
      // QB penalty at 1 owned is +18: adjustedScore 40+18=58 vs WR 41+0=41.
      const qb = await createRosteredPlayer({ fullName: "QB2 candidate", position: "QB" });
      await addAdp(qb.id, "PPR", 40);
      const wr = await createRosteredPlayer({ fullName: "WR candidate", position: "WR" });
      await addAdp(wr.id, "PPR", 41);

      const result = await select(draft.id, bot.id, league.scoringFormat);

      expect(result).toBe(wr.id);
    });

    it("owning two QBs applies a strong penalty; a nearby WR/RB beats QB3", async () => {
      const { draft, bot, league } = await createDraftContext("PPR");
      await giveBotPositionCount(draft.id, bot.id, "QB", 2);
      // Mirrors the CLAUDE.md/plan worked example: QB at ADP 40 with WR 41,
      // RB 42 nearby. adjustedScore(QB) = 40+60=100, clearly loses.
      const qb = await createRosteredPlayer({ fullName: "QB3 candidate", position: "QB" });
      await addAdp(qb.id, "PPR", 40);
      const wr = await createRosteredPlayer({ fullName: "WR candidate", position: "WR" });
      await addAdp(wr.id, "PPR", 41);
      const rb = await createRosteredPlayer({ fullName: "RB candidate", position: "RB" });
      await addAdp(rb.id, "PPR", 42);

      const result = await select(draft.id, bot.id, league.scoringFormat);

      expect(result).toBe(wr.id);
      expect(result).not.toBe(qb.id);
    });

    it("a sufficiently large ADP value gap can still make QB2 win over the penalty", async () => {
      const { draft, bot, league } = await createDraftContext("PPR");
      await giveBotPositionCount(draft.id, bot.id, "QB", 1);
      // QB penalty at 1 owned is +18. A QB at ADP 5 (adjustedScore 23) still
      // beats ordinary competing candidates around ADP 20-25.
      const qb = await createRosteredPlayer({ fullName: "Elite value QB2", position: "QB" });
      await addAdp(qb.id, "PPR", 5);
      const wr = await createRosteredPlayer({ fullName: "Ordinary WR", position: "WR" });
      await addAdp(wr.id, "PPR", 24);

      const result = await select(draft.id, bot.id, league.scoringFormat);

      expect(result).toBe(qb.id);
    });
  });

  describe("TE", () => {
    it("owning one TE applies a moderate penalty", async () => {
      const { draft, bot, league } = await createDraftContext("PPR");
      await giveBotPositionCount(draft.id, bot.id, "TE", 1);
      const te = await createRosteredPlayer({ fullName: "TE2 candidate", position: "TE" });
      await addAdp(te.id, "PPR", 40);
      const wr = await createRosteredPlayer({ fullName: "WR candidate", position: "WR" });
      await addAdp(wr.id, "PPR", 41);

      const result = await select(draft.id, bot.id, league.scoringFormat);

      expect(result).toBe(wr.id);
    });

    it("owning two or more TEs applies a strong penalty and a nearby alternative wins", async () => {
      const { draft, bot, league } = await createDraftContext("PPR");
      await giveBotPositionCount(draft.id, bot.id, "TE", 2);
      const te = await createRosteredPlayer({ fullName: "TE3 candidate", position: "TE" });
      await addAdp(te.id, "PPR", 40);
      const rb = await createRosteredPlayer({ fullName: "RB candidate", position: "RB" });
      await addAdp(rb.id, "PPR", 42);

      const result = await select(draft.id, bot.id, league.scoringFormat);

      expect(result).toBe(rb.id);
    });
  });

  describe("RB/WR depth", () => {
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

    it("deeper RB ownership (4+) receives only a small penalty — enough to tip a near-tied comparison, no more", async () => {
      const { draft, bot, league } = await createDraftContext("PPR");
      await giveBotPositionCount(draft.id, bot.id, "RB", 4);
      // RB penalty at 4+ owned is +12. adjustedScore(RB)=30+12=42 vs WR
      // 41+0=41 — WR wins narrowly, proving the penalty is real (it moved
      // the outcome) but small (a 1-point margin, not a rout).
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
      // WR penalty at 5+ owned is +12. adjustedScore(WR)=10+12=22, still
      // clearly beats an ordinary QB at ADP 40.
      const wr = await createRosteredPlayer({ fullName: "Elite value WR6", position: "WR" });
      await addAdp(wr.id, "PPR", 10);
      const qb = await createRosteredPlayer({ fullName: "Ordinary QB", position: "QB" });
      await addAdp(qb.id, "PPR", 40);

      const result = await select(draft.id, bot.id, league.scoringFormat);

      expect(result).toBe(wr.id);
    });
  });

  describe("ownership scoping", () => {
    it("only counts the current BOT's own Picks toward its position penalties", async () => {
      const { draft, bot, league } = await createDraftContext("PPR");
      const otherBot = await createTestBotMember(league.id, 2);
      // The OTHER bot is heavily QB-stocked; this must not affect `bot`.
      await giveBotPositionCount(draft.id, otherBot.id, "QB", 3);
      const qb = await createRosteredPlayer({ fullName: "QB candidate", position: "QB" });
      await addAdp(qb.id, "PPR", 20);
      const wr = await createRosteredPlayer({ fullName: "WR candidate", position: "WR" });
      await addAdp(wr.id, "PPR", 21);

      const result = await select(draft.id, bot.id, league.scoringFormat);

      // `bot` owns zero QBs (only otherBot does), so QB (unpenalized, lower
      // raw ADP) still wins.
      expect(result).toBe(qb.id);
    });

    it("ownership is keyed by leagueMemberId, not any user identity", async () => {
      const { draft, bot, league } = await createDraftContext("PPR");
      // bot.userId is null (a BOT); giveBotPositionCount attributes Picks by
      // bot.id specifically, proving the query never touches userId.
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

    it("tier 1 (has ADP) always outranks tier 2 (no ADP), even against a heavy penalty", async () => {
      const { draft, bot, league } = await createDraftContext("PPR");
      await giveBotPositionCount(draft.id, bot.id, "QB", 2);
      // adjustedScore(QB) = 180 (near-worst real ADP) + 60 = 240 — still
      // tier 1, so it must beat any tier-2 (no ADP) candidate regardless.
      const qb = await createRosteredPlayer({ fullName: "Penalized QB", position: "QB" });
      await addAdp(qb.id, "PPR", 180);
      const noAdp = await createRosteredPlayer({ fullName: "No ADP", position: "WR", searchRank: 1 });

      const result = await select(draft.id, bot.id, league.scoringFormat);

      expect(result).toBe(qb.id);
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

  // Post-5.5 product decision: K/DEF are strongly discouraged (a +100
  // timing penalty) everywhere except the final 3 rounds
  // (lateWindowStart = max(1, rosterSize - 2)), on top of the same kind of
  // duplicate-ownership penalty every other position already has. All
  // fixtures below use rosterSize=15, teamCount=4, so lateWindowStart = 13:
  // round 12 (pickNumberForRound(12, 4) = 45) is early/mid, round 13
  // (pickNumberForRound(13, 4) = 49) is the first late-window round.
  describe("K/DEF timing penalty (round 12/13 boundary)", () => {
    for (const position of ["K", "DEF"] as const) {
      it(`${position}: round 12 — a nearby non-K/DEF candidate beats it due to the +100 timing penalty`, async () => {
        const { draft, bot, league } = await createDraftContext("PPR");
        const round12Pick = pickNumberForRound(12, league.teamCount);
        const target = await createRosteredPlayer({ fullName: `${position} candidate`, position });
        await addAdp(target.id, "PPR", 40); // attractive raw ADP
        const rb = await createRosteredPlayer({ fullName: "RB candidate", position: "RB" });
        await addAdp(rb.id, "PPR", 45); // worse raw ADP, but unpenalized

        const result = await select(draft.id, bot.id, league.scoringFormat, {
          rosterSize: league.rosterSize,
          teamCount: league.teamCount,
          currentPickNumber: round12Pick,
        });

        // adjustedScore(target) = 40 + 100 = 140; adjustedScore(rb) = 45.
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

        // adjustedScore(target) = 40 + 0 = 40; adjustedScore(rb) = 45.
        expect(result).toBe(target.id);
      });
    }
  });

  describe("K/DEF is a soft penalty, not an absolute exclusion", () => {
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

      // adjustedScore(K) = 5 + 100 = 105; adjustedScore(rb) = 200. The
      // penalty is real (it would have lost to an ordinary ~45 ADP
      // competitor, per the round-12 test above) but not absolute.
      expect(result).toBe(k.id);
    });
  });

  // Verifies the exact duplicate-penalty bands (0/+40/+80), independently
  // inside and outside the late window (where the +100 timing component is
  // 0 or 100 respectively), for both K and DEF. Each case is proven to the
  // exact integer via two bracketing sub-cases: a competitor exactly
  // (expectedPenalty - 1) worse in raw ADP than the K/DEF candidate must
  // still win (proves the penalty isn't smaller than expected), and a
  // competitor exactly (expectedPenalty + 1) worse must lose (proves the
  // penalty isn't larger than expected).
  describe("K/DEF duplicate-ownership penalty (exact values)", () => {
    const rosterSize = 15;
    const teamCount = 4; // lateWindowStart = 13
    const lateWindowPick = pickNumberForRound(13, teamCount);
    const earlyWindowPick = pickNumberForRound(12, teamCount);

    const cases: Array<{ label: string; owned: number; currentPickNumber: number; expectedPenalty: number }> = [
      { label: "late window, first K/DEF (0 owned)", owned: 0, currentPickNumber: lateWindowPick, expectedPenalty: 0 },
      { label: "late window, second K/DEF (1 owned)", owned: 1, currentPickNumber: lateWindowPick, expectedPenalty: 40 },
      { label: "late window, third+ K/DEF (2 owned)", owned: 2, currentPickNumber: lateWindowPick, expectedPenalty: 80 },
      {
        label: "before late window, second K/DEF (1 owned)",
        owned: 1,
        currentPickNumber: earlyWindowPick,
        expectedPenalty: 140,
      },
      {
        label: "before late window, third+ K/DEF (2 owned)",
        owned: 2,
        currentPickNumber: earlyWindowPick,
        expectedPenalty: 180,
      },
    ];

    async function expectExactPenalty(
      position: "K" | "DEF",
      owned: number,
      currentPickNumber: number,
      expectedPenalty: number,
    ) {
      // Lower bound: a competitor exactly (expectedPenalty - 1) worse in
      // raw ADP still has a smaller adjustedScore than the penalized
      // target, so it should win. This proves the penalty is at least
      // `expectedPenalty`.
      {
        const { draft, bot, league } = await createDraftContext("PPR", { rosterSize, teamCount });
        if (owned > 0) await giveBotPositionCount(draft.id, bot.id, position, owned);
        const target = await createRosteredPlayer({ fullName: `${position} candidate`, position });
        await addAdp(target.id, "PPR", 50);
        const competitor = await createRosteredPlayer({ fullName: "Competitor (just better)", position: "RB" });
        await addAdp(competitor.id, "PPR", 50 + expectedPenalty - 1);

        const result = await select(draft.id, bot.id, league.scoringFormat, {
          rosterSize,
          teamCount,
          currentPickNumber,
        });
        expect(result, `${position} owned=${owned}: competitor at ADP 50+${expectedPenalty}-1 should win`).toBe(
          competitor.id,
        );
      }

      // Each bracketing sub-case creates its own League/Draft/Players, but
      // eligibility is scoped by "not drafted in *this* draftId" (correctly
      // — see "keeps a player eligible if drafted only in a different
      // draft" above), so a fresh cleanup is required between the two
      // sub-cases: otherwise the lower-bound block's still-undrafted
      // fixture Players would remain eligible candidates for the
      // upper-bound block's own (different-draftId) select() call too,
      // contaminating its candidate pool.
      await cleanupLeagueTestData();

      // Upper bound: a competitor exactly (expectedPenalty + 1) worse in
      // raw ADP should now lose to the K/DEF candidate. This proves the
      // penalty is at most `expectedPenalty`.
      {
        const { draft, bot, league } = await createDraftContext("PPR", { rosterSize, teamCount });
        if (owned > 0) await giveBotPositionCount(draft.id, bot.id, position, owned);
        const target = await createRosteredPlayer({ fullName: `${position} candidate`, position });
        await addAdp(target.id, "PPR", 50);
        const competitor = await createRosteredPlayer({ fullName: "Competitor (just worse)", position: "RB" });
        await addAdp(competitor.id, "PPR", 50 + expectedPenalty + 1);

        const result = await select(draft.id, bot.id, league.scoringFormat, {
          rosterSize,
          teamCount,
          currentPickNumber,
        });
        expect(result, `${position} owned=${owned}: target should win over a competitor at ADP 50+${expectedPenalty}+1`).toBe(
          target.id,
        );
      }
    }

    for (const position of ["K", "DEF"] as const) {
      describe(position, () => {
        for (const c of cases) {
          it(`${c.label} -> penalty ${c.expectedPenalty}`, async () => {
            await expectExactPenalty(position, c.owned, c.currentPickNumber, c.expectedPenalty);
          });
        }
      });
    }
  });

  describe("short-roster-size boundary (rosterSize=8, final 3 rounds = 6-8)", () => {
    it("round 5 (before the late window) applies the timing penalty", async () => {
      const rosterSize = 8;
      const teamCount = 4; // lateWindowStart = max(1, 8-2) = 6
      const { draft, bot, league } = await createDraftContext("PPR", { rosterSize, teamCount });
      const round5Pick = pickNumberForRound(5, teamCount);
      const k = await createRosteredPlayer({ fullName: "K candidate", position: "K" });
      await addAdp(k.id, "PPR", 40);
      const rb = await createRosteredPlayer({ fullName: "RB candidate", position: "RB" });
      await addAdp(rb.id, "PPR", 45);

      const result = await select(draft.id, bot.id, league.scoringFormat, {
        rosterSize,
        teamCount,
        currentPickNumber: round5Pick,
      });

      expect(result).toBe(rb.id);
    });

    it("round 6 (the first late-window round) removes the timing penalty", async () => {
      const rosterSize = 8;
      const teamCount = 4;
      const { draft, bot, league } = await createDraftContext("PPR", { rosterSize, teamCount });
      const round6Pick = pickNumberForRound(6, teamCount);
      const k = await createRosteredPlayer({ fullName: "K candidate", position: "K" });
      await addAdp(k.id, "PPR", 40);
      const rb = await createRosteredPlayer({ fullName: "RB candidate", position: "RB" });
      await addAdp(rb.id, "PPR", 45);

      const result = await select(draft.id, bot.id, league.scoringFormat, {
        rosterSize,
        teamCount,
        currentPickNumber: round6Pick,
      });

      expect(result).toBe(k.id);
    });
  });
});
