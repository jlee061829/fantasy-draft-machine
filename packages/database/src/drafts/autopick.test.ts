import { randomUUID } from "node:crypto";
import { getPickerForPickNumber } from "@fdm/shared";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { prisma } from "../client.js";
import { cleanupLeagueTestData, createTestPlayer, createTestUser } from "../test-support/db.js";
import type { ScoringFormat } from "../generated/prisma/client.js";
import { findExpiredActiveDraftLeagueIds, processExpiredDraftTurn } from "./autopick.js";
import { AutopickExhaustedError } from "./errors.js";
import { submitPick } from "./submit-pick.js";

interface LeagueOverrides {
  teamCount?: number;
  rosterSize?: number;
  timerSeconds?: number;
  draftType?: "SNAKE" | "LINEAR";
  scoringFormat?: ScoringFormat;
  turnDeadline?: Date;
}

async function createTestLeague(ownerId: string, overrides: LeagueOverrides = {}) {
  return prisma.league.create({
    data: {
      name: "Autopick Test League",
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

async function addMember(leagueId: string, userId: string, draftSlot: number) {
  return prisma.leagueMember.create({ data: { leagueId, userId, draftSlot } });
}

// Creates a fully-filled ACTIVE draft directly via prisma, defaulting to an
// already-expired turnDeadline since that's what most tests below need.
// Deliberately duplicated (not imported) from apps/socket-server's
// equivalent test-support helper — packages/database must not depend on
// apps/socket-server, and this is a small enough fixture that sharing it
// isn't worth a cross-package dependency.
async function startFullDraft(overrides: LeagueOverrides = {}) {
  const teamCount = overrides.teamCount ?? 4;
  const owner = await createTestUser();
  const league = await createTestLeague(owner.id, overrides);
  await addMember(league.id, owner.id, 1);

  const others = await Promise.all(Array.from({ length: teamCount - 1 }, () => createTestUser()));
  await Promise.all(others.map((user, i) => addMember(league.id, user.id, i + 2)));

  const membersBySlot: Record<number, string> = { 1: owner.id };
  others.forEach((user, i) => {
    membersBySlot[i + 2] = user.id;
  });

  const draft = await prisma.draft.create({
    data: {
      leagueId: league.id,
      status: "ACTIVE",
      currentPickNumber: 1,
      currentUserId: owner.id,
      turnDeadline: overrides.turnDeadline ?? new Date(Date.now() - 1_000),
    },
  });

  return { league, owner, membersBySlot, draft };
}

async function createPlayerWithAdp(
  format: ScoringFormat,
  adp: number,
  overrides: Partial<{ fullName: string; position: string }> = {},
) {
  const player = await createTestPlayer(overrides);
  await prisma.playerAdp.create({ data: { playerId: player.id, format, adp, source: "test" } });
  return player;
}

describe("processExpiredDraftTurn", () => {
  beforeEach(async () => {
    await cleanupLeagueTestData();
  });

  afterEach(async () => {
    await cleanupLeagueTestData();
  });

  describe("expiry re-check and progression", () => {
    it("autopicks exactly once for a normally expired turn, persisting wasAutopick: true", async () => {
      const { league, draft } = await startFullDraft({ teamCount: 4 });
      await createPlayerWithAdp(league.scoringFormat, 1);

      const outcome = await processExpiredDraftTurn(league.id);

      expect(outcome.outcome).toBe("picked");
      if (outcome.outcome !== "picked") throw new Error("unreachable");
      expect(outcome.result.pick.wasAutopick).toBe(true);
      expect(outcome.result.pick.userId).toBe(draft.currentUserId);
      const pickCount = await prisma.pick.count({ where: { draftId: draft.id } });
      expect(pickCount).toBe(1);
    });

    it("advances currentUserId to the correct next picker", async () => {
      const { league, membersBySlot } = await startFullDraft({
        teamCount: 4,
        draftType: "SNAKE",
      });
      await createPlayerWithAdp(league.scoringFormat, 1);

      const outcome = await processExpiredDraftTurn(league.id);

      expect(outcome.outcome).toBe("picked");
      if (outcome.outcome !== "picked") throw new Error("unreachable");
      const expectedSlot = getPickerForPickNumber(2, 4, "SNAKE");
      expect(outcome.result.draft.currentUserId).toBe(membersBySlot[expectedSlot]);
    });

    it("advances turnDeadline from server time by League.timerSeconds", async () => {
      const { league } = await startFullDraft({ teamCount: 4, timerSeconds: 45 });
      await createPlayerWithAdp(league.scoringFormat, 1);
      const before = Date.now();

      const outcome = await processExpiredDraftTurn(league.id);

      expect(outcome.outcome).toBe("picked");
      if (outcome.outcome !== "picked") throw new Error("unreachable");
      const deadline = new Date(outcome.result.draft.turnDeadline!).getTime();
      expect(deadline).toBeGreaterThanOrEqual(before + 45_000);
      expect(deadline).toBeLessThan(before + 45_000 + 5_000);
    });

    it("completes the draft on the final autopick with the correct terminal state", async () => {
      const { league, draft } = await startFullDraft({ teamCount: 4, rosterSize: 1 });
      // rosterSize 1 * teamCount 4 = 4 total picks. Drive the first 3 via
      // manual submitPick, then let the final turn expire into autopick.
      let currentUserId = draft.currentUserId!;
      for (let i = 0; i < 3; i++) {
        const player = await createPlayerWithAdp(league.scoringFormat, i + 1);
        const result = await submitPick(league.id, currentUserId, player.id);
        currentUserId = result.draft.currentUserId!;
      }
      await prisma.draft.update({
        where: { id: draft.id },
        data: { turnDeadline: new Date(Date.now() - 1_000) },
      });
      await createPlayerWithAdp(league.scoringFormat, 99);

      const outcome = await processExpiredDraftTurn(league.id);

      expect(outcome.outcome).toBe("picked");
      if (outcome.outcome !== "picked") throw new Error("unreachable");
      expect(outcome.result.draft.status).toBe("COMPLETE");
      expect(outcome.result.draft.currentUserId).toBeNull();
      expect(outcome.result.draft.turnDeadline).toBeNull();
      expect(outcome.result.pick.wasAutopick).toBe(true);

      const persisted = await prisma.draft.findUnique({ where: { id: draft.id } });
      expect(persisted?.status).toBe("COMPLETE");
      const pickCount = await prisma.pick.count({ where: { draftId: draft.id } });
      expect(pickCount).toBe(4);
    });
  });

  describe("stale/no-op outcomes", () => {
    it("skips (does not double-pick) a turn already consumed by a manual pick", async () => {
      const { league, draft } = await startFullDraft({ teamCount: 4 });
      const player = await createTestPlayer();
      await submitPick(league.id, draft.currentUserId!, player.id);

      const outcome = await processExpiredDraftTurn(league.id);

      expect(outcome).toEqual({
        outcome: "skipped",
        leagueId: league.id,
        reason: "ALREADY_ADVANCED",
      });
      const pickCount = await prisma.pick.count({ where: { draftId: draft.id } });
      expect(pickCount).toBe(1);
    });

    it("skips a draft whose deadline has not actually passed", async () => {
      const { league, draft } = await startFullDraft({
        teamCount: 4,
        turnDeadline: new Date(Date.now() + 60_000),
      });

      const outcome = await processExpiredDraftTurn(league.id);

      expect(outcome).toEqual({
        outcome: "skipped",
        leagueId: league.id,
        reason: "ALREADY_ADVANCED",
      });
      const pickCount = await prisma.pick.count({ where: { draftId: draft.id } });
      expect(pickCount).toBe(0);
    });

    it("skips a league with no draft yet", async () => {
      const owner = await createTestUser();
      const league = await createTestLeague(owner.id);

      const outcome = await processExpiredDraftTurn(league.id);

      expect(outcome).toEqual({ outcome: "skipped", leagueId: league.id, reason: "NO_DRAFT" });
    });

    it("skips an already-COMPLETE draft", async () => {
      const { league, draft } = await startFullDraft({ teamCount: 4, rosterSize: 1 });
      let currentUserId = draft.currentUserId!;
      for (let i = 0; i < 4; i++) {
        const player = await createTestPlayer();
        const result = await submitPick(league.id, currentUserId, player.id);
        currentUserId = result.draft.currentUserId ?? currentUserId;
      }
      const completed = await prisma.draft.findUnique({ where: { id: draft.id } });
      expect(completed?.status).toBe("COMPLETE");

      const outcome = await processExpiredDraftTurn(league.id);

      expect(outcome).toEqual({ outcome: "skipped", leagueId: league.id, reason: "NOT_ACTIVE" });
    });
  });

  describe("concurrency", () => {
    it("a manual pick racing an expired-turn autopick results in exactly one accepted pick", async () => {
      const { league, draft } = await startFullDraft({ teamCount: 4 });
      const manualPlayer = await createTestPlayer();
      await createPlayerWithAdp(league.scoringFormat, 1);

      const [manualOutcome, autoOutcome] = await Promise.allSettled([
        submitPick(league.id, draft.currentUserId!, manualPlayer.id),
        processExpiredDraftTurn(league.id),
      ]);

      const pickCount = await prisma.pick.count({ where: { draftId: draft.id } });
      expect(pickCount).toBe(1);

      const manualWon = manualOutcome.status === "fulfilled";
      const autoWon =
        autoOutcome.status === "fulfilled" && autoOutcome.value.outcome === "picked";
      expect(manualWon !== autoWon).toBe(true);
      if (!autoWon && autoOutcome.status === "fulfilled") {
        expect(autoOutcome.value).toEqual({
          outcome: "skipped",
          leagueId: league.id,
          reason: "ALREADY_ADVANCED",
        });
      }
    });

    it("two concurrent processExpiredDraftTurn calls for the same draft produce exactly one Pick", async () => {
      const { league, draft } = await startFullDraft({ teamCount: 4 });
      await createPlayerWithAdp(league.scoringFormat, 1);

      const [first, second] = await Promise.all([
        processExpiredDraftTurn(league.id),
        processExpiredDraftTurn(league.id),
      ]);

      const outcomes = [first, second];
      expect(outcomes.filter((o) => o.outcome === "picked")).toHaveLength(1);
      const skipped = outcomes.filter((o) => o.outcome === "skipped");
      expect(skipped).toHaveLength(1);
      expect(skipped[0]).toMatchObject({ outcome: "skipped", reason: "ALREADY_ADVANCED" });

      const pickCount = await prisma.pick.count({ where: { draftId: draft.id } });
      expect(pickCount).toBe(1);
    });
  });

  describe("player selection", () => {
    it("selects the lowest-ADP undrafted player for the league's scoring format", async () => {
      const { league } = await startFullDraft({ teamCount: 4, scoringFormat: "PPR" });
      const worse = await createPlayerWithAdp("PPR", 50, { fullName: "Worse ADP" });
      const better = await createPlayerWithAdp("PPR", 5, { fullName: "Better ADP" });

      const outcome = await processExpiredDraftTurn(league.id);

      expect(outcome.outcome).toBe("picked");
      if (outcome.outcome !== "picked") throw new Error("unreachable");
      expect(outcome.result.pick.playerId).toBe(better.id);
      expect(outcome.result.pick.playerId).not.toBe(worse.id);
    });

    it("never selects a player already drafted in this draft", async () => {
      const { league, draft } = await startFullDraft({ teamCount: 4 });
      const alreadyDrafted = await createPlayerWithAdp(league.scoringFormat, 1, {
        fullName: "Taken",
      });
      const nextBest = await createPlayerWithAdp(league.scoringFormat, 2, {
        fullName: "Next best",
      });
      await submitPick(league.id, draft.currentUserId!, alreadyDrafted.id);
      await prisma.draft.update({
        where: { id: draft.id },
        data: { turnDeadline: new Date(Date.now() - 1_000) },
      });

      const outcome = await processExpiredDraftTurn(league.id);

      expect(outcome.outcome).toBe("picked");
      if (outcome.outcome !== "picked") throw new Error("unreachable");
      expect(outcome.result.pick.playerId).toBe(nextBest.id);
    });

    it("falls back to lowest searchRank when no undrafted player has an ADP row for this format", async () => {
      const { league } = await startFullDraft({ teamCount: 4, scoringFormat: "PPR" });
      const worseRank = await createTestPlayer({ fullName: "Worse Rank", searchRank: 200 });
      const betterRank = await createTestPlayer({ fullName: "Better Rank", searchRank: 10 });

      const outcome = await processExpiredDraftTurn(league.id);

      expect(outcome.outcome).toBe("picked");
      if (outcome.outcome !== "picked") throw new Error("unreachable");
      expect(outcome.result.pick.playerId).toBe(betterRank.id);
      expect(outcome.result.pick.playerId).not.toBe(worseRank.id);
    });

    it("prefers ADP over searchRank when both are available", async () => {
      const { league } = await startFullDraft({ teamCount: 4, scoringFormat: "PPR" });
      const hasAdp = await createPlayerWithAdp("PPR", 100, { fullName: "Has ADP" });
      const noAdpButGoodRank = await createTestPlayer({ fullName: "No ADP", searchRank: 1 });

      const outcome = await processExpiredDraftTurn(league.id);

      expect(outcome.outcome).toBe("picked");
      if (outcome.outcome !== "picked") throw new Error("unreachable");
      expect(outcome.result.pick.playerId).toBe(hasAdp.id);
      expect(outcome.result.pick.playerId).not.toBe(noAdpButGoodRank.id);
    });

    it("throws AutopickExhaustedError when no undrafted player exists", async () => {
      const { league } = await startFullDraft({ teamCount: 4 });

      await expect(processExpiredDraftTurn(league.id)).rejects.toBeInstanceOf(
        AutopickExhaustedError,
      );
    });
  });
});

describe("findExpiredActiveDraftLeagueIds", () => {
  beforeEach(async () => {
    await cleanupLeagueTestData();
  });

  afterEach(async () => {
    await cleanupLeagueTestData();
  });

  it("returns leagueIds for ACTIVE drafts past their deadline and excludes future/complete/draft-less leagues", async () => {
    const { league: expiredLeague } = await startFullDraft({ teamCount: 4 });
    const { league: futureLeague } = await startFullDraft({
      teamCount: 4,
      turnDeadline: new Date(Date.now() + 60_000),
    });
    const owner = await createTestUser();
    const draftlessLeague = await createTestLeague(owner.id);

    const ids = await findExpiredActiveDraftLeagueIds();

    expect(ids).toContain(expiredLeague.id);
    expect(ids).not.toContain(futureLeague.id);
    expect(ids).not.toContain(draftlessLeague.id);
  });
});
