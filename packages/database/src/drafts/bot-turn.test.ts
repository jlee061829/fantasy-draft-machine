import { randomUUID } from "node:crypto";
import { getPickerForPickNumber } from "@fdm/shared";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { prisma } from "../client.js";
import {
  cleanupLeagueTestData,
  createTestBotMember,
  createTestPlayer,
  createTestUser,
} from "../test-support/db.js";
import type { ScoringFormat } from "../generated/prisma/client.js";
import { findActiveBotTurnLeagueIds, processBotDraftTurn } from "./bot-turn.js";
import { BotPickExhaustedError, NotOnTheClockError } from "./errors.js";
import { submitPick } from "./submit-pick.js";

interface LeagueOverrides {
  teamCount?: number;
  rosterSize?: number;
  timerSeconds?: number;
  draftType?: "SNAKE" | "LINEAR";
  scoringFormat?: ScoringFormat;
}

async function createTestLeague(ownerId: string, overrides: LeagueOverrides = {}) {
  return prisma.league.create({
    data: {
      name: "Bot Turn Test League",
      ownerId,
      rosterSize: overrides.rosterSize ?? 8,
      teamCount: overrides.teamCount ?? 4,
      inviteCode: randomUUID().replace(/-/g, "").slice(0, 8).toUpperCase(),
      timerSeconds: overrides.timerSeconds ?? 60,
      scoringFormat: overrides.scoringFormat ?? "PPR",
      draftType: overrides.draftType ?? "SNAKE",
    },
  });
}

// A fully-filled ACTIVE draft whose slot 1 is a BOT and slots 2..teamCount
// are HUMAN — enough to exercise BOT->HUMAN/BOT->BOT progression and
// getPickerForPickNumber-driven advancement, without needing every slot to
// be a BOT. currentMemberId starts at the BOT (slot 1).
async function startDraftWithBotOnClock(overrides: LeagueOverrides = {}) {
  const teamCount = overrides.teamCount ?? 4;
  const owner = await createTestUser();
  const league = await createTestLeague(owner.id, overrides);
  const bot = await createTestBotMember(league.id, 1);

  const others = await Promise.all(Array.from({ length: teamCount - 1 }, () => createTestUser()));
  const otherMemberships = await Promise.all(
    others.map((user, i) =>
      prisma.leagueMember.create({ data: { leagueId: league.id, userId: user.id, draftSlot: i + 2 } }),
    ),
  );

  const membershipsBySlot: Record<number, string> = { 1: bot.id };
  otherMemberships.forEach((membership, i) => {
    membershipsBySlot[i + 2] = membership.id;
  });

  const draft = await prisma.draft.create({
    data: {
      leagueId: league.id,
      status: "ACTIVE",
      currentPickNumber: 1,
      currentMemberId: bot.id,
      turnDeadline: new Date(Date.now() + (overrides.timerSeconds ?? 60) * 1000),
    },
  });

  return { league, bot, membershipsBySlot, draft };
}

async function createPlayerWithAdp(
  format: ScoringFormat,
  adp: number,
  overrides: Partial<{ fullName: string; nflTeam: string | null }> = {},
) {
  const player = await createTestPlayer({ nflTeam: "KC", ...overrides });
  await prisma.playerAdp.create({ data: { playerId: player.id, format, adp, source: "test" } });
  return player;
}

describe("processBotDraftTurn", () => {
  beforeEach(async () => {
    await cleanupLeagueTestData();
  });

  afterEach(async () => {
    await cleanupLeagueTestData();
  });

  describe("normal progression", () => {
    it("applies exactly one Pick for an ACTIVE draft with a BOT current participant", async () => {
      const { league, bot, draft } = await startDraftWithBotOnClock({ teamCount: 4 });
      await createPlayerWithAdp(league.scoringFormat, 1);

      const outcome = await processBotDraftTurn(league.id);

      expect(outcome.outcome).toBe("picked");
      if (outcome.outcome !== "picked") throw new Error("unreachable");
      expect(outcome.result.pick.leagueMemberId).toBe(bot.id);
      expect(outcome.result.pick.wasAutopick).toBe(false);
      const pickCount = await prisma.pick.count({ where: { draftId: draft.id } });
      expect(pickCount).toBe(1);
    });

    it("selects the player BEST_AVAILABLE would choose", async () => {
      const { league } = await startDraftWithBotOnClock({ teamCount: 4, scoringFormat: "PPR" });
      const worse = await createPlayerWithAdp("PPR", 50, { fullName: "Worse ADP" });
      const better = await createPlayerWithAdp("PPR", 5, { fullName: "Better ADP" });

      const outcome = await processBotDraftTurn(league.id);

      expect(outcome.outcome).toBe("picked");
      if (outcome.outcome !== "picked") throw new Error("unreachable");
      expect(outcome.result.pick.playerId).toBe(better.id);
      expect(outcome.result.pick.playerId).not.toBe(worse.id);
    });

    it("advances currentPickNumber and currentMemberId to the correct next picker (BOT -> HUMAN)", async () => {
      const { league, membershipsBySlot } = await startDraftWithBotOnClock({
        teamCount: 4,
        draftType: "SNAKE",
      });
      await createPlayerWithAdp(league.scoringFormat, 1);

      const outcome = await processBotDraftTurn(league.id);

      expect(outcome.outcome).toBe("picked");
      if (outcome.outcome !== "picked") throw new Error("unreachable");
      expect(outcome.result.draft.currentPickNumber).toBe(2);
      const expectedSlot = getPickerForPickNumber(2, 4, "SNAKE");
      expect(outcome.result.draft.currentMemberId).toBe(membershipsBySlot[expectedSlot]);
    });

    it("writes a fresh deadline from server time plus League.timerSeconds", async () => {
      const { league } = await startDraftWithBotOnClock({ teamCount: 4, timerSeconds: 45 });
      await createPlayerWithAdp(league.scoringFormat, 1);
      const before = Date.now();

      const outcome = await processBotDraftTurn(league.id);

      expect(outcome.outcome).toBe("picked");
      if (outcome.outcome !== "picked") throw new Error("unreachable");
      const deadline = new Date(outcome.result.draft.turnDeadline!).getTime();
      expect(deadline).toBeGreaterThanOrEqual(before + 45_000);
      expect(deadline).toBeLessThan(before + 45_000 + 5_000);
    });

    it("advances BOT -> BOT when the next slot is also a BOT", async () => {
      const owner = await createTestUser();
      const league = await createTestLeague(owner.id, { teamCount: 4, draftType: "LINEAR" });
      const bot1 = await createTestBotMember(league.id, 1);
      const bot2 = await createTestBotMember(league.id, 2);
      await prisma.leagueMember.create({ data: { leagueId: league.id, userId: owner.id, draftSlot: 3 } });
      const other = await createTestUser();
      await prisma.leagueMember.create({ data: { leagueId: league.id, userId: other.id, draftSlot: 4 } });
      await prisma.draft.create({
        data: {
          leagueId: league.id,
          status: "ACTIVE",
          currentPickNumber: 1,
          currentMemberId: bot1.id,
          turnDeadline: new Date(Date.now() + 60_000),
        },
      });
      await createPlayerWithAdp(league.scoringFormat, 1, { fullName: "First pick" });

      const outcome = await processBotDraftTurn(league.id);

      expect(outcome.outcome).toBe("picked");
      if (outcome.outcome !== "picked") throw new Error("unreachable");
      expect(outcome.result.draft.currentMemberId).toBe(bot2.id);
    });

    it("completes the draft on the final BOT pick with the correct terminal state", async () => {
      // A 1-team, 1-round, BOT-only draft: pick 1 is both the first and the
      // final pick, and the sole participant is the BOT — the simplest
      // unambiguous fixture for "the final pick, made by a BOT, completes
      // the draft," without needing to drive several picks through a larger
      // league first.
      const owner = await createTestUser();
      const league = await createTestLeague(owner.id, { teamCount: 1, rosterSize: 1 });
      const bot = await createTestBotMember(league.id, 1);
      const draft = await prisma.draft.create({
        data: {
          leagueId: league.id,
          status: "ACTIVE",
          currentPickNumber: 1,
          currentMemberId: bot.id,
          turnDeadline: new Date(Date.now() + 60_000),
        },
      });
      await createPlayerWithAdp(league.scoringFormat, 1);

      const outcome = await processBotDraftTurn(league.id);

      expect(outcome.outcome).toBe("picked");
      if (outcome.outcome !== "picked") throw new Error("unreachable");
      expect(outcome.result.draft.status).toBe("COMPLETE");
      expect(outcome.result.draft.currentMemberId).toBeNull();
      expect(outcome.result.draft.turnDeadline).toBeNull();

      const persisted = await prisma.draft.findUnique({ where: { id: draft.id } });
      expect(persisted?.status).toBe("COMPLETE");
    });
  });

  describe("no-op outcomes", () => {
    it("skips a league with no draft yet", async () => {
      const owner = await createTestUser();
      const league = await createTestLeague(owner.id);

      const outcome = await processBotDraftTurn(league.id);

      expect(outcome).toEqual({ outcome: "skipped", leagueId: league.id, reason: "NO_DRAFT" });
    });

    it("skips an already-COMPLETE draft", async () => {
      const owner = await createTestUser();
      const league = await createTestLeague(owner.id, { teamCount: 1, rosterSize: 1 });
      await createTestBotMember(league.id, 1);
      await prisma.draft.create({
        data: {
          leagueId: league.id,
          status: "COMPLETE",
          currentPickNumber: 1,
          currentMemberId: null,
          turnDeadline: null,
        },
      });

      const outcome = await processBotDraftTurn(league.id);

      expect(outcome).toEqual({ outcome: "skipped", leagueId: league.id, reason: "NOT_ACTIVE" });
    });

    it("skips when the current participant is HUMAN, writing no Pick", async () => {
      const owner = await createTestUser();
      const league = await createTestLeague(owner.id, { teamCount: 4 });
      const membership = await prisma.leagueMember.create({
        data: { leagueId: league.id, userId: owner.id, draftSlot: 1 },
      });
      const draft = await prisma.draft.create({
        data: {
          leagueId: league.id,
          status: "ACTIVE",
          currentPickNumber: 1,
          currentMemberId: membership.id,
          turnDeadline: new Date(Date.now() + 60_000),
        },
      });

      const outcome = await processBotDraftTurn(league.id);

      expect(outcome).toEqual({ outcome: "skipped", leagueId: league.id, reason: "NOT_BOT_TURN" });
      const pickCount = await prisma.pick.count({ where: { draftId: draft.id } });
      expect(pickCount).toBe(0);
    });
  });

  describe("exhaustion", () => {
    it("throws BotPickExhaustedError and leaves Draft/Pick state fully unchanged", async () => {
      const { league, bot, draft } = await startDraftWithBotOnClock({ teamCount: 4 });
      // No eligible rostered player exists at all.

      await expect(processBotDraftTurn(league.id)).rejects.toBeInstanceOf(BotPickExhaustedError);

      const persisted = await prisma.draft.findUnique({ where: { id: draft.id } });
      expect(persisted?.status).toBe("ACTIVE");
      expect(persisted?.currentPickNumber).toBe(1);
      expect(persisted?.currentMemberId).toBe(bot.id);
      const pickCount = await prisma.pick.count({ where: { draftId: draft.id } });
      expect(pickCount).toBe(0);
    });
  });

  describe("concurrency", () => {
    it("two concurrent processBotDraftTurn calls for the same draft produce exactly one Pick", async () => {
      const { league, draft } = await startDraftWithBotOnClock({ teamCount: 4 });
      await createPlayerWithAdp(league.scoringFormat, 1);

      const [first, second] = await Promise.all([
        processBotDraftTurn(league.id),
        processBotDraftTurn(league.id),
      ]);

      const outcomes = [first, second];
      expect(outcomes.filter((o) => o.outcome === "picked")).toHaveLength(1);
      const skipped = outcomes.filter((o) => o.outcome === "skipped");
      expect(skipped).toHaveLength(1);
      expect(skipped[0]).toMatchObject({ outcome: "skipped", reason: "NOT_BOT_TURN" });

      const pickCount = await prisma.pick.count({ where: { draftId: draft.id } });
      expect(pickCount).toBe(1);
    });
  });
});

describe("findActiveBotTurnLeagueIds", () => {
  beforeEach(async () => {
    await cleanupLeagueTestData();
  });

  afterEach(async () => {
    await cleanupLeagueTestData();
  });

  it("includes an ACTIVE draft with a BOT current participant, regardless of turnDeadline", async () => {
    const { league } = await startDraftWithBotOnClock({ teamCount: 4 });

    const ids = await findActiveBotTurnLeagueIds();

    expect(ids).toContain(league.id);
  });

  it("excludes an ACTIVE draft whose current participant is HUMAN", async () => {
    const owner = await createTestUser();
    const league = await createTestLeague(owner.id, { teamCount: 4 });
    const membership = await prisma.leagueMember.create({
      data: { leagueId: league.id, userId: owner.id, draftSlot: 1 },
    });
    await prisma.draft.create({
      data: {
        leagueId: league.id,
        status: "ACTIVE",
        currentPickNumber: 1,
        currentMemberId: membership.id,
        turnDeadline: new Date(Date.now() + 60_000),
      },
    });

    const ids = await findActiveBotTurnLeagueIds();

    expect(ids).not.toContain(league.id);
  });

  it("excludes a COMPLETE draft even if its currentMember reference were somehow a BOT", async () => {
    const owner = await createTestUser();
    const league = await createTestLeague(owner.id, { teamCount: 1, rosterSize: 1 });
    await createTestBotMember(league.id, 1);
    await prisma.draft.create({
      data: {
        leagueId: league.id,
        status: "COMPLETE",
        currentPickNumber: 1,
        currentMemberId: null,
        turnDeadline: null,
      },
    });

    const ids = await findActiveBotTurnLeagueIds();

    expect(ids).not.toContain(league.id);
  });

  it("excludes a league with no Draft at all", async () => {
    const owner = await createTestUser();
    const league = await createTestLeague(owner.id);

    const ids = await findActiveBotTurnLeagueIds();

    expect(ids).not.toContain(league.id);
  });
});

// This is deliberately NOT testing any new BOT-authorization guard — there
// is none, and none was added. It proves the existing, unmodified
// (leagueId, userId)-keyed identity architecture from submitPick already
// makes it impossible for a human to submit a pick "as" a BOT: a human's
// own membership always resolves to their own (non-BOT) LeagueMember row,
// which structurally cannot equal draft.currentMemberId when a BOT is on
// the clock, so the existing NotOnTheClockError check already rejects this
// with no code change required.
describe("submitPick while a BOT is the current participant", () => {
  beforeEach(async () => {
    await cleanupLeagueTestData();
  });

  afterEach(async () => {
    await cleanupLeagueTestData();
  });

  it("rejects a HUMAN's submitPick with NotOnTheClockError, leaving Draft/Pick state unchanged", async () => {
    const human = await createTestUser();
    const league = await createTestLeague(human.id, { teamCount: 2 });
    const humanMembership = await prisma.leagueMember.create({
      data: { leagueId: league.id, userId: human.id, draftSlot: 1 },
    });
    const bot = await createTestBotMember(league.id, 2);
    const draft = await prisma.draft.create({
      data: {
        leagueId: league.id,
        status: "ACTIVE",
        currentPickNumber: 1,
        currentMemberId: bot.id,
        turnDeadline: new Date(Date.now() + 60_000),
      },
    });
    const player = await createTestPlayer({ nflTeam: "KC" });

    // The human's own membership resolves normally and genuinely is not
    // the current picker — this is the precondition the rest of the test
    // depends on, made explicit rather than assumed.
    expect(humanMembership.userId).toBe(human.id);
    expect(humanMembership.id).not.toBe(draft.currentMemberId);

    await expect(submitPick(league.id, human.id, player.id)).rejects.toBeInstanceOf(
      NotOnTheClockError,
    );

    const pickCount = await prisma.pick.count({ where: { draftId: draft.id } });
    expect(pickCount).toBe(0);
    const persisted = await prisma.draft.findUnique({ where: { id: draft.id } });
    expect(persisted?.currentMemberId).toBe(bot.id);
    expect(persisted?.currentPickNumber).toBe(1);
  });
});
