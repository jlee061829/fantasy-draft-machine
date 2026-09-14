import { randomUUID } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { prisma } from "../client.js";
import { cleanupLeagueTestData, createTestBotMember, createTestUser } from "../test-support/db.js";
import { processBotDraftTurn } from "./bot-turn.js";

// Phase 5.5: a slower, isolated full-draft simulation, kept in its own file
// (separate from bot-turn.test.ts's focused wiring test and
// position-aware-selection.test.ts's focused ranking-rule tests) so it's
// easy to identify/skip if it ever becomes a runtime problem. It exists to
// answer a question the focused tests can't: does the position-aware
// strategy produce *plausible whole rosters* over a full, realistically-
// sized draft, not just correct individual comparisons?
//
// The synthetic player pool below is NOT randomly generated — it's a fixed,
// deterministic position sequence engineered to mirror the real seeded PPR
// ADP order this repository's dev database was found to have (see the
// Phase 5.5 implementation report): RB/WR dominant in the first ~60 picks
// (ranks 1-60 below are taken directly from that real observed order), QB
// appearing from the high-20s, TE from the mid-30s, DEF first appearing
// around rank ~92, K around rank ~128. ADP is set equal to rank (1..200),
// so ordering is unambiguous and the whole draft (180 picks) is satisfied
// entirely within this single synthetic ADP tier — matching the real
// finding that a 12-team x 15-round draft never reaches the searchRank
// fallback tier at all.
function buildSyntheticPositionOrder(): string[] {
  // Ranks 1-60: taken directly from a real query against this repo's
  // seeded dev database (PPR ADP order, nflTeam IS NOT NULL).
  const observedEarlyRounds = [
    "RB", "RB", "WR", "WR", "RB", "WR", "WR", "RB", "RB", "WR",
    "WR", "WR", "RB", "RB", "WR", "RB", "RB", "WR", "RB", "RB",
    "WR", "WR", "WR", "RB", "RB", "RB", "WR", "QB", "RB", "WR",
    "WR", "RB", "WR", "RB", "WR", "WR", "TE", "RB", "RB", "WR",
    "TE", "WR", "WR", "RB", "RB", "WR", "WR", "WR", "WR", "RB",
    "QB", "RB", "WR", "QB", "WR", "RB", "WR", "QB", "WR", "WR",
  ];

  // Ranks 61-91 (31 slots): RB/WR still dominant with QB/TE mixed in, no
  // DEF/K yet — real DEF ADP doesn't start until ~92, K until ~128.
  const midRoundsCycle = ["RB", "WR", "QB", "WR", "RB", "TE", "WR", "RB"];
  const midRounds = Array.from({ length: 31 }, (_, i) => midRoundsCycle[i % midRoundsCycle.length]!);

  // Ranks 92-127 (36 slots): DEF enters, K still doesn't.
  const preKCycle = ["RB", "WR", "DEF", "RB", "WR", "QB", "RB", "WR", "RB", "WR", "TE", "RB"];
  const preKRounds = Array.from({ length: 36 }, (_, i) => preKCycle[i % preKCycle.length]!);

  // Ranks 128-200 (73 slots): K enters alongside continuing RB/WR/QB/TE/DEF
  // depth.
  const finalCycle = ["RB", "WR", "DEF", "RB", "WR", "QB", "K", "RB", "WR", "TE", "RB", "WR"];
  const finalRounds = Array.from({ length: 73 }, (_, i) => finalCycle[i % finalCycle.length]!);

  return [...observedEarlyRounds, ...midRounds, ...preKRounds, ...finalRounds];
}

async function createTestLeague(ownerId: string, teamCount: number, rosterSize: number) {
  return prisma.league.create({
    data: {
      name: "Bot Strategy Simulation League",
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

// Seeds `count` rostered synthetic Players, ADP == 1-indexed rank (PPR),
// searchRank == rank, positions from buildSyntheticPositionOrder(). Player
// identity for comparison purposes should use fullName (deterministic,
// "Sim Player N"), never the DB-generated id, which differs across runs.
async function seedSyntheticPlayerPool(count: number) {
  const positions = buildSyntheticPositionOrder();
  if (positions.length < count) {
    throw new Error(`Synthetic position order only has ${positions.length} entries, need ${count}`);
  }
  for (let rank = 1; rank <= count; rank++) {
    const player = await prisma.player.create({
      data: {
        sleeperId: `sim-${randomUUID()}`,
        fullName: `Sim Player ${rank}`,
        position: positions[rank - 1]!,
        nflTeam: "SIM",
        searchRank: rank,
      },
    });
    await prisma.playerAdp.create({
      data: { playerId: player.id, format: "PPR", adp: rank, source: "test" },
    });
  }
}

async function createAllBotLeague(teamCount: number, rosterSize: number) {
  const owner = await createTestUser();
  const league = await createTestLeague(owner.id, teamCount, rosterSize);
  const bots = await Promise.all(
    Array.from({ length: teamCount }, (_, i) => createTestBotMember(league.id, i + 1)),
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
  return { league, bots, draft };
}

// Drives a Draft to completion purely through processBotDraftTurn, exactly
// mirroring what apps/socket-server's BOT sweep does one tick at a time
// (minus the socket/broadcast layer, which is out of scope for
// @fdm/database tests). Returns the full pick sequence for inspection.
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

describe("bot strategy simulation (Phase 5.5)", () => {
  beforeEach(async () => {
    await cleanupLeagueTestData();
  });

  afterEach(async () => {
    await cleanupLeagueTestData();
  });

  it(
    "drives a 12-team, 15-round, all-BOT SNAKE draft to completion with plausible roster composition",
    async () => {
      const teamCount = 12;
      const rosterSize = 15;
      const totalPicks = teamCount * rosterSize; // 180
      const { league, bots, draft } = await createAllBotLeague(teamCount, rosterSize);
      await seedSyntheticPlayerPool(200);

      const picks = await runFullBotDraft(league.id, totalPicks);

      // --- hard correctness invariants ---
      expect(picks).toHaveLength(totalPicks);
      const uniquePlayerIds = new Set(picks.map((p) => p.playerId));
      expect(uniquePlayerIds.size).toBe(totalPicks); // no duplicate Player

      const finalDraft = await prisma.draft.findUnique({ where: { id: draft.id } });
      expect(finalDraft?.status).toBe("COMPLETE");
      expect(finalDraft?.currentMemberId).toBeNull();
      expect(finalDraft?.turnDeadline).toBeNull();

      const persistedPickCount = await prisma.pick.count({ where: { draftId: draft.id } });
      expect(persistedPickCount).toBe(totalPicks);

      const picksByMember = new Map<string, typeof picks>();
      for (const pick of picks) {
        const list = picksByMember.get(pick.leagueMemberId) ?? [];
        list.push(pick);
        picksByMember.set(pick.leagueMemberId, list);
      }
      expect(picksByMember.size).toBe(teamCount);
      for (const bot of bots) {
        expect(picksByMember.get(bot.id)).toHaveLength(rosterSize);
      }

      // pickNumber sequence is contiguous 1..180 with no gaps/repeats —
      // confirms legal turn progression start to finish.
      const pickNumbers = picks.map((p) => p.pickNumber).sort((a, b) => a - b);
      expect(pickNumbers).toEqual(Array.from({ length: totalPicks }, (_, i) => i + 1));

      // --- position composition, reported for the implementation report ---
      const players = await prisma.player.findMany({ select: { id: true, position: true } });
      const positionById = new Map(players.map((p) => [p.id, p.position]));

      const draftSlotByMemberId = new Map(bots.map((bot, i) => [bot.id, i + 1]));
      type Distribution = Record<string, number>;
      const distributionBySlot: Record<number, Distribution> = {};
      let earliestKPick: number | null = null;
      let earliestDefPick: number | null = null;

      for (const pick of picks) {
        const slot = draftSlotByMemberId.get(pick.leagueMemberId)!;
        const position = positionById.get(pick.playerId)!;
        const dist = (distributionBySlot[slot] ??= {});
        dist[position] = (dist[position] ?? 0) + 1;
        if (position === "K" && earliestKPick === null) earliestKPick = pick.pickNumber;
        if (position === "DEF" && earliestDefPick === null) earliestDefPick = pick.pickNumber;
      }

      // Logged (not asserted) for the implementation report: per-slot
      // position distributions and earliest K/DEF pick/round.
      // eslint-disable-next-line no-console
      console.log(
        "[bot-strategy-simulation] per-slot distributions:",
        JSON.stringify(distributionBySlot, null, 2),
      );
      const earliestKRound = earliestKPick ? Math.ceil(earliestKPick / teamCount) : null;
      const earliestDefRound = earliestDefPick ? Math.ceil(earliestDefPick / teamCount) : null;
      // eslint-disable-next-line no-console
      console.log("[bot-strategy-simulation] earliest K pick/round:", earliestKPick, earliestKRound);
      // eslint-disable-next-line no-console
      console.log(
        "[bot-strategy-simulation] earliest DEF pick/round:",
        earliestDefPick,
        earliestDefRound,
      );

      // --- broad plausibility invariants (not lineup-slot enforcement) ---
      const kCounts: number[] = [];
      const defCounts: number[] = [];
      for (const [slot, dist] of Object.entries(distributionBySlot)) {
        const qbCount = dist.QB ?? 0;
        const teCount = dist.TE ?? 0;
        const rbWrCount = (dist.RB ?? 0) + (dist.WR ?? 0);
        kCounts.push(dist.K ?? 0);
        defCounts.push(dist.DEF ?? 0);
        // No clearly degenerate stockpiling (the "5 QBs / 5 TEs" scenario
        // this milestone exists to avoid). Deliberately not asserting a
        // minimum QB/TE count — 5.5 implements no minimum-position
        // guarantee.
        expect(qbCount, `slot ${slot} QB count`).toBeLessThanOrEqual(4);
        expect(teCount, `slot ${slot} TE count`).toBeLessThanOrEqual(4);
        // RB/WR should make up meaningful depth of a 15-round roster.
        expect(rbWrCount, `slot ${slot} RB+WR count`).toBeGreaterThanOrEqual(5);
      }

      const countBuckets = (counts: number[]) => ({
        zero: counts.filter((c) => c === 0).length,
        one: counts.filter((c) => c === 1).length,
        twoPlus: counts.filter((c) => c >= 2).length,
      });
      // eslint-disable-next-line no-console
      console.log("[bot-strategy-simulation] K count buckets (0/1/2+):", countBuckets(kCounts));
      // eslint-disable-next-line no-console
      console.log("[bot-strategy-simulation] DEF count buckets (0/1/2+):", countBuckets(defCounts));

      // Post-5.5 product decision: K/DEF are explicitly, strongly
      // discouraged before the final 3 rounds (rosterSize=15 ->
      // lateWindowStart=13), overriding raw ADP rather than merely
      // following it. This is a tighter, rule-driven expectation than the
      // original 5.5 "empirically late" floor — allow exactly one round of
      // slack (>= 12) for the soft-penalty design's own documented
      // tolerance of an extreme candidate-pool situation overriding the
      // penalty, per this round's product-decision instructions ("do not
      // fail purely because one extreme synthetic case produces a round-12
      // pick").
      expect(earliestDefRound).not.toBeNull();
      expect(earliestKRound).not.toBeNull();
      expect(earliestDefRound!, "earliest DEF round").toBeGreaterThanOrEqual(12);
      expect(earliestKRound!, "earliest K round").toBeGreaterThanOrEqual(12);
    },
    60_000,
  );

  // Determinism at full-draft scale, kept at a smaller scale (4 teams x 15
  // rounds = 60 picks, run twice) than the 12x15 composition simulation
  // above to keep runtime reasonable — selector-level determinism (identical
  // state -> identical single pick) is already exhaustively covered in
  // position-aware-selection.test.ts; this proves it holds across an entire
  // draft's worth of sequential state changes, not just one isolated call.
  //
  // Player identity is compared by fullName (deterministically assigned,
  // "Sim Player N"), never by DB-generated id — a fresh Player pool is
  // seeded for each of the two runs, so ids necessarily differ between them
  // even though the two runs are otherwise identical. draftSlot (not
  // LeagueMember.id, also freshly generated per run) identifies which bot
  // made each pick.
  it(
    "produces an identical pick sequence (by pickNumber/draftSlot/playerFullName) across two independent runs of the same initial state",
    async () => {
      const teamCount = 4;
      const rosterSize = 15;
      const totalPicks = teamCount * rosterSize; // 60

      async function runOnce() {
        const { league, bots } = await createAllBotLeague(teamCount, rosterSize);
        await seedSyntheticPlayerPool(200);
        const picks = await runFullBotDraft(league.id, totalPicks);
        const players = await prisma.player.findMany({ select: { id: true, fullName: true } });
        const fullNameById = new Map(players.map((p) => [p.id, p.fullName]));
        const draftSlotByMemberId = new Map(bots.map((bot, i) => [bot.id, i + 1]));
        return picks
          .map((p) => ({
            pickNumber: p.pickNumber,
            draftSlot: draftSlotByMemberId.get(p.leagueMemberId)!,
            playerFullName: fullNameById.get(p.playerId)!,
          }))
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
