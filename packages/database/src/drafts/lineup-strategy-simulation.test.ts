import { randomUUID } from "node:crypto";
import { BOT_STRATEGY_ROTATION, canFieldStartingLineup, getBackupWindowStart, type BotStrategy } from "@fdm/shared";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { prisma } from "../client.js";
import { cleanupLeagueTestData, createTestBotMember, createTestUser } from "../test-support/db.js";
import { processBotDraftTurn } from "./bot-turn.js";

// Phase 5.6: full-draft simulations proving the lineup-feasibility +
// onesie-cap + strategy-variant architecture holds at realistic scale, not
// just in the focused unit/integration tests elsewhere. Kept in its own
// file (like Phase 5.5's bot-strategy-simulation.test.ts) so a slow
// full-draft run is easy to identify/skip if it ever becomes a runtime
// problem.
//
// The synthetic player pool is deliberately NOT the same one Phase 5.5
// used: that pool only had ~6 DEF and ~6 K for a 12-team draft, which is
// far below the 12 DEF / 12 K a Phase 5.6 lineup-completion guarantee
// actually needs — Phase 5.5 never asserted "every BOT can field a lineup"
// so that scarcity was invisible before. This pool is built in contiguous
// per-position ADP blocks specifically so each position's own supply count
// is exact and known, and so a player's *positional* ADP rank (its index
// within its own block) is trivial to compute directly in the test without
// re-deriving it from getPositionalAdpRank (already covered by
// positional-adp-rank.test.ts).
interface PoolConfig {
  earlyRbWr: number; // split evenly RB/WR, lowest (best) ADP band
  qbCount: number;
  teCount: number;
  laterRbWr: number; // split evenly RB/WR, mid ADP band
  kCount: number;
  defCount: number;
}

interface SeededPool {
  qbPositionalRankByFullName: Map<string, number>;
  tePositionalRankByFullName: Map<string, number>;
}

async function seedPool(config: PoolConfig): Promise<SeededPool> {
  let rank = 1;
  const qbPositionalRankByFullName = new Map<string, number>();
  const tePositionalRankByFullName = new Map<string, number>();

  async function createPlayer(position: string, positionalRank?: number) {
    const fullName = `Sim ${position} rank${rank}`;
    const player = await prisma.player.create({
      data: { sleeperId: `sim-${randomUUID()}`, fullName, position, nflTeam: "SIM", searchRank: rank },
    });
    await prisma.playerAdp.create({ data: { playerId: player.id, format: "PPR", adp: rank, source: "test" } });
    if (position === "QB" && positionalRank !== undefined) qbPositionalRankByFullName.set(fullName, positionalRank);
    if (position === "TE" && positionalRank !== undefined) tePositionalRankByFullName.set(fullName, positionalRank);
    rank += 1;
    return player;
  }

  for (let i = 0; i < config.earlyRbWr; i++) {
    await createPlayer(i % 2 === 0 ? "RB" : "WR");
  }
  for (let i = 0; i < config.qbCount; i++) {
    await createPlayer("QB", i + 1);
  }
  for (let i = 0; i < config.teCount; i++) {
    await createPlayer("TE", i + 1);
  }
  for (let i = 0; i < config.laterRbWr; i++) {
    await createPlayer(i % 2 === 0 ? "RB" : "WR");
  }
  for (let i = 0; i < config.defCount; i++) {
    await createPlayer("DEF");
  }
  for (let i = 0; i < config.kCount; i++) {
    await createPlayer("K");
  }

  return { qbPositionalRankByFullName, tePositionalRankByFullName };
}

async function createTestLeague(ownerId: string, teamCount: number, rosterSize: number) {
  return prisma.league.create({
    data: {
      name: "Lineup Strategy Simulation League",
      ownerId,
      rosterSize,
      teamCount,
      inviteCode: randomUUID().replace(/-/g, "").slice(0, 8).toUpperCase(),
      timerSeconds: 60,
      scoringFormat: "PPR",
      draftType: "SNAKE",
    },
  });
}

// Deterministic strategy rotation, identical to fillOpenLeagueSlotsWithBots'
// own assignment order — for teamCount a multiple of 4, this yields exactly
// teamCount/4 bots of each of the 4 strategies.
async function createAllBotLeague(teamCount: number, rosterSize: number) {
  const owner = await createTestUser();
  const league = await createTestLeague(owner.id, teamCount, rosterSize);
  const strategyBySlot = new Map<number, BotStrategy>();
  const bots = await Promise.all(
    Array.from({ length: teamCount }, (_, i) => {
      const strategy = BOT_STRATEGY_ROTATION[i % BOT_STRATEGY_ROTATION.length]!;
      strategyBySlot.set(i + 1, strategy);
      return createTestBotMember(league.id, i + 1, { botStrategy: strategy });
    }),
  );
  const draft = await prisma.draft.create({
    data: {
      leagueId: league.id,
      status: "ACTIVE",
      currentPickNumber: 1,
      currentMemberId: bots[0]!.id,
      turnDeadline: new Date(Date.now() + 60_000),
    },
  });
  return { league, bots, draft, strategyBySlot };
}

async function runFullBotDraft(leagueId: string, expectedTotalPicks: number) {
  const picks: Array<{ pickNumber: number; leagueMemberId: string; playerId: string }> = [];
  for (let i = 0; i < expectedTotalPicks; i++) {
    const outcome = await processBotDraftTurn(leagueId);
    if (outcome.outcome !== "picked") {
      throw new Error(
        `Expected a "picked" outcome at simulation step ${i + 1}, got "${outcome.outcome}"` +
          (outcome.outcome === "skipped" ? ` (${outcome.reason})` : ""),
      );
    }
    picks.push({
      pickNumber: outcome.result.pick.pickNumber,
      leagueMemberId: outcome.result.pick.leagueMemberId,
      playerId: outcome.result.pick.playerId,
    });
  }
  return picks;
}

describe("lineup-aware bot strategy simulation (Phase 5.6)", () => {
  beforeEach(async () => {
    await cleanupLeagueTestData();
  });

  afterEach(async () => {
    await cleanupLeagueTestData();
  });

  it(
    "12-team, 15-round, all-BOT SNAKE draft: completes, every roster obeys hard caps, every BOT can field a valid lineup",
    async () => {
      const teamCount = 12;
      const rosterSize = 15;
      const totalPicks = teamCount * rosterSize; // 180
      const { league, bots, draft, strategyBySlot } = await createAllBotLeague(teamCount, rosterSize);
      // RB/WR are the only uncapped positions (QB<=2, TE<=2, K<=1, DEF<=1
      // combined <= 6 per bot), so at least rosterSize-6=9 of every bot's
      // 15 picks must come from RB/WR, and in practice more (most bots
      // won't max every onesie cap) — worst case here is
      // 12 * (15-4) = 132. 200 gives comfortable headroom.
      const pool = await seedPool({ earlyRbWr: 100, qbCount: 30, teCount: 30, laterRbWr: 100, kCount: 15, defCount: 15 });

      const picks = await runFullBotDraft(league.id, totalPicks);

      // --- hard correctness invariants ---
      expect(picks).toHaveLength(totalPicks);
      expect(new Set(picks.map((p) => p.playerId)).size).toBe(totalPicks);
      const finalDraft = await prisma.draft.findUnique({ where: { id: draft.id } });
      expect(finalDraft?.status).toBe("COMPLETE");
      expect(finalDraft?.currentMemberId).toBeNull();
      const pickNumbers = picks.map((p) => p.pickNumber).sort((a, b) => a - b);
      expect(pickNumbers).toEqual(Array.from({ length: totalPicks }, (_, i) => i + 1));

      // --- per-bot roster assembly ---
      const players = await prisma.player.findMany({ select: { id: true, position: true, fullName: true } });
      const playerById = new Map(players.map((p) => [p.id, p]));
      const draftSlotByMemberId = new Map(bots.map((bot, i) => [bot.id, i + 1]));

      type BotRoster = { slot: number; strategy: BotStrategy; counts: Record<string, number>; picksInOrder: typeof picks };
      const rosterByMember = new Map<string, BotRoster>();
      for (const bot of bots) {
        const slot = draftSlotByMemberId.get(bot.id)!;
        rosterByMember.set(bot.id, { slot, strategy: strategyBySlot.get(slot)!, counts: {}, picksInOrder: [] });
      }
      for (const pick of picks.sort((a, b) => a.pickNumber - b.pickNumber)) {
        const roster = rosterByMember.get(pick.leagueMemberId)!;
        const position = playerById.get(pick.playerId)!.position;
        roster.counts[position] = (roster.counts[position] ?? 0) + 1;
        roster.picksInOrder.push(pick);
      }

      expect(rosterByMember.size).toBe(teamCount);

      let qb1OnlyCount = 0;
      let qb2Count = 0;
      let te1OnlyCount = 0;
      let te2Count = 0;
      const backupWindowStart = getBackupWindowStart(rosterSize);
      const perStrategyTotals = new Map<BotStrategy, Record<string, number[]>>();

      for (const roster of rosterByMember.values()) {
        expect(roster.picksInOrder).toHaveLength(rosterSize);

        // --- universal hard cap invariants (item 18/35) ---
        expect(roster.counts.K ?? 0, `slot ${roster.slot} K count`).toBeLessThanOrEqual(1);
        expect(roster.counts.DEF ?? 0, `slot ${roster.slot} DEF count`).toBeLessThanOrEqual(1);
        expect(roster.counts.QB ?? 0, `slot ${roster.slot} QB count`).toBeLessThanOrEqual(2);
        expect(roster.counts.TE ?? 0, `slot ${roster.slot} TE count`).toBeLessThanOrEqual(2);

        // --- the primary Phase 5.6 correctness invariant ---
        expect(canFieldStartingLineup(roster.counts), `slot ${roster.slot} lineup`).toBe(true);

        // --- QB1/QB2, TE1/TE2 distribution + backup-eligibility proof ---
        const qbPicks = roster.picksInOrder.filter((p) => playerById.get(p.playerId)!.position === "QB");
        if (qbPicks.length === 1) qb1OnlyCount++;
        if (qbPicks.length === 2) {
          qb2Count++;
          const qb1Rank = pool.qbPositionalRankByFullName.get(playerById.get(qbPicks[0]!.playerId)!.fullName)!;
          const qb2Round = Math.ceil(qbPicks[1]!.pickNumber / teamCount);
          expect(qb1Rank, `slot ${roster.slot} QB1 must be non-elite for a QB2 to exist`).toBeGreaterThan(8);
          expect(qb2Round, `slot ${roster.slot} QB2 must be drafted in the backup window`).toBeGreaterThanOrEqual(
            backupWindowStart,
          );
        }

        const tePicks = roster.picksInOrder.filter((p) => playerById.get(p.playerId)!.position === "TE");
        if (tePicks.length === 1) te1OnlyCount++;
        if (tePicks.length === 2) {
          te2Count++;
          const te1Rank = pool.tePositionalRankByFullName.get(playerById.get(tePicks[0]!.playerId)!.fullName)!;
          const te2Round = Math.ceil(tePicks[1]!.pickNumber / teamCount);
          expect(te1Rank, `slot ${roster.slot} TE1 must be non-elite for a TE2 to exist`).toBeGreaterThan(5);
          expect(te2Round, `slot ${roster.slot} TE2 must be drafted in the backup window`).toBeGreaterThanOrEqual(
            backupWindowStart,
          );
        }

        const totals = perStrategyTotals.get(roster.strategy) ?? {};
        for (const position of ["QB", "RB", "WR", "TE", "K", "DEF"]) {
          (totals[position] ??= []).push(roster.counts[position] ?? 0);
        }
        perStrategyTotals.set(roster.strategy, totals);
      }

      const avg = (nums: number[]) => nums.reduce((a, b) => a + b, 0) / nums.length;
      const report: Record<string, Record<string, number>> = {};
      for (const [strategy, totals] of perStrategyTotals.entries()) {
        report[strategy] = Object.fromEntries(
          Object.entries(totals).map(([position, counts]) => [position, Number(avg(counts).toFixed(2))]),
        );
      }
      // eslint-disable-next-line no-console
      console.log("[lineup-strategy-simulation] per-strategy average roster shape:", JSON.stringify(report, null, 2));
      // eslint-disable-next-line no-console
      console.log("[lineup-strategy-simulation] QB1-only vs QB2:", { qb1OnlyCount, qb2Count });
      // eslint-disable-next-line no-console
      console.log("[lineup-strategy-simulation] TE1-only vs TE2:", { te1OnlyCount, te2Count });

      // --- directional strategy differentiation (not exact numbers) ---
      const rbAvg = (s: BotStrategy) => avg(perStrategyTotals.get(s)!.RB!);
      const wrAvg = (s: BotStrategy) => avg(perStrategyTotals.get(s)!.WR!);
      expect(rbAvg("RB_HEAVY"), "RB_HEAVY should carry more RB depth than WR_HEAVY").toBeGreaterThan(rbAvg("WR_HEAVY"));
      expect(wrAvg("WR_HEAVY"), "WR_HEAVY should carry more WR depth than RB_HEAVY").toBeGreaterThan(wrAvg("RB_HEAVY"));
      // HERO_RB is distinguishable from BALANCED in at least one of RB/WR
      // shape — not asserting a specific direction, since HERO_RB's effect
      // is on *timing* (one early RB, then a sharp discourage) more than on
      // final bench totals, which can converge with BALANCED's own totals
      // by the end of a full 15-round draft.
      const heroRbShape = perStrategyTotals.get("HERO_RB")!;
      const balancedShape = perStrategyTotals.get("BALANCED")!;
      const shapesDiffer = ["QB", "RB", "WR", "TE", "K", "DEF"].some(
        (position) => avg(heroRbShape[position]!) !== avg(balancedShape[position]!),
      );
      expect(shapesDiffer, "HERO_RB must produce a measurably different roster shape than BALANCED").toBe(true);
    },
    60_000,
  );

  it(
    "20-team, 15-round, all-BOT SNAKE stress draft (real-dev-supply K=43/DEF=32): completes with every lineup fillable and no K2/DEF2",
    async () => {
      const teamCount = 20;
      const rosterSize = 15;
      const totalPicks = teamCount * rosterSize; // 300
      const { league, bots, draft } = await createAllBotLeague(teamCount, rosterSize);
      // Worst-case RB/WR need at 20 teams: 20 * (15-4) = 220; 300 gives
      // comfortable headroom (see the 12-team test's comment for the
      // underlying arithmetic).
      await seedPool({ earlyRbWr: 150, qbCount: 50, teCount: 50, laterRbWr: 150, kCount: 43, defCount: 32 });

      const picks = await runFullBotDraft(league.id, totalPicks);

      expect(picks).toHaveLength(totalPicks);
      expect(new Set(picks.map((p) => p.playerId)).size).toBe(totalPicks);
      const finalDraft = await prisma.draft.findUnique({ where: { id: draft.id } });
      expect(finalDraft?.status).toBe("COMPLETE");

      const players = await prisma.player.findMany({ select: { id: true, position: true } });
      const positionById = new Map(players.map((p) => [p.id, p.position]));
      const draftSlotByMemberId = new Map(bots.map((bot, i) => [bot.id, i + 1]));
      const countsByMember = new Map<string, Record<string, number>>();
      for (const pick of picks) {
        const counts = countsByMember.get(pick.leagueMemberId) ?? {};
        const position = positionById.get(pick.playerId)!;
        counts[position] = (counts[position] ?? 0) + 1;
        countsByMember.set(pick.leagueMemberId, counts);
      }

      expect(countsByMember.size).toBe(teamCount);
      let totalK = 0;
      let totalDef = 0;
      for (const bot of bots) {
        const slot = draftSlotByMemberId.get(bot.id)!;
        const counts = countsByMember.get(bot.id)!;
        expect(counts.K ?? 0, `slot ${slot} K count`).toBeLessThanOrEqual(1);
        expect(counts.DEF ?? 0, `slot ${slot} DEF count`).toBeLessThanOrEqual(1);
        expect(canFieldStartingLineup(counts), `slot ${slot} lineup at 20-team scale`).toBe(true);
        totalK += counts.K ?? 0;
        totalDef += counts.DEF ?? 0;
      }
      // eslint-disable-next-line no-console
      console.log("[lineup-strategy-simulation] 20-team totals — K:", totalK, "DEF:", totalDef);
      // No K2/DEF2 anywhere: total consumption cannot exceed teamCount for
      // either position under the hard per-BOT cap — this is the direct
      // empirical confirmation of the analytical no-global-reservation-
      // needed argument (all-BOT case only; not generalized to mixed
      // HUMAN/BOT leagues — see bot-turn.test.ts's mixed-scarcity test).
      expect(totalK).toBeLessThanOrEqual(teamCount);
      expect(totalDef).toBeLessThanOrEqual(teamCount);
    },
    120_000,
  );

  // Determinism at full-draft scale, kept at a smaller size (4 teams x 15
  // rounds = 60 picks, run twice) for runtime reasons — selector-level
  // determinism (identical state -> identical single pick) is already
  // exhaustively covered in position-aware-selection.test.ts; this proves
  // it holds across an entire draft's worth of sequential state changes,
  // including the deterministic strategy-rotation assignment itself.
  it(
    "produces an identical pick sequence (pickNumber/draftSlot/playerFullName/botStrategy) across two independent runs",
    async () => {
      const teamCount = 4;
      const rosterSize = 15;
      const totalPicks = teamCount * rosterSize; // 60

      async function runOnce() {
        const { league, bots, strategyBySlot } = await createAllBotLeague(teamCount, rosterSize);
        await seedPool({ earlyRbWr: 30, qbCount: 10, teCount: 10, laterRbWr: 30, kCount: 6, defCount: 6 });
        const picks = await runFullBotDraft(league.id, totalPicks);
        const players = await prisma.player.findMany({ select: { id: true, fullName: true } });
        const fullNameById = new Map(players.map((p) => [p.id, p.fullName]));
        const draftSlotByMemberId = new Map(bots.map((bot, i) => [bot.id, i + 1]));
        return picks
          .map((p) => {
            const slot = draftSlotByMemberId.get(p.leagueMemberId)!;
            return {
              pickNumber: p.pickNumber,
              draftSlot: slot,
              playerFullName: fullNameById.get(p.playerId)!,
              botStrategy: strategyBySlot.get(slot)!,
            };
          })
          .sort((a, b) => a.pickNumber - b.pickNumber);
      }

      const first = await runOnce();
      await cleanupLeagueTestData();
      const second = await runOnce();

      expect(second).toEqual(first);
    },
    60_000,
  );
});
