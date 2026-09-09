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
//
// Phase 5.1: returns membersBySlot (slot -> userId, needed to call
// submitPick, which still authenticates humans by userId) alongside
// membershipsBySlot (slot -> LeagueMember.id, what Draft.currentMemberId/
// Pick.leagueMemberId actually store) and userIdByMembershipId (the
// reverse lookup tests use to keep tracking "the current picker" across a
// loop of many picks without recomputing getPickerForPickNumber).
async function startFullDraft(overrides: LeagueOverrides = {}) {
  const teamCount = overrides.teamCount ?? 4;
  const owner = await createTestUser();
  const league = await createTestLeague(owner.id, overrides);
  const ownerMembership = await addMember(league.id, owner.id, 1);

  const others = await Promise.all(Array.from({ length: teamCount - 1 }, () => createTestUser()));
  const otherMemberships = await Promise.all(
    others.map((user, i) => addMember(league.id, user.id, i + 2)),
  );

  const membersBySlot: Record<number, string> = { 1: owner.id };
  const membershipsBySlot: Record<number, string> = { 1: ownerMembership.id };
  const userIdByMembershipId: Record<string, string> = { [ownerMembership.id]: owner.id };
  others.forEach((user, i) => {
    membersBySlot[i + 2] = user.id;
    membershipsBySlot[i + 2] = otherMemberships[i]!.id;
    userIdByMembershipId[otherMemberships[i]!.id] = user.id;
  });

  const draft = await prisma.draft.create({
    data: {
      leagueId: league.id,
      status: "ACTIVE",
      currentPickNumber: 1,
      currentMemberId: ownerMembership.id,
      turnDeadline: overrides.turnDeadline ?? new Date(Date.now() - 1_000),
    },
  });

  return { league, owner, membersBySlot, membershipsBySlot, userIdByMembershipId, draft };
}

// Phase 5.3: a minimal ACTIVE draft whose current participant is a BOT, for
// exercising processExpiredDraftTurn's/findExpiredActiveDraftLeagueIds'
// HUMAN-only guard/filter. Deliberately a single-BOT fixture — these tests
// only need "current participant is a BOT," not a fully-filled league.
async function startDraftWithBotCurrent(overrides: LeagueOverrides = {}) {
  const owner = await createTestUser();
  const league = await createTestLeague(owner.id, overrides);
  const bot = await createTestBotMember(league.id, 1);

  const draft = await prisma.draft.create({
    data: {
      leagueId: league.id,
      status: "ACTIVE",
      currentPickNumber: 1,
      currentMemberId: bot.id,
      turnDeadline: overrides.turnDeadline ?? new Date(Date.now() - 1_000),
    },
  });

  return { league, bot, draft };
}

// Defaults to a rostered player (nflTeam set) since that's the eligible
// shape selectBestAvailablePlayerId requires as of Phase 5.2 — these
// higher-level autopick tests exist to prove the wiring into that selector
// still works end to end, not to re-cover its ranking rules (see
// player-selection.test.ts for exhaustive ranking/eligibility coverage).
async function createPlayerWithAdp(
  format: ScoringFormat,
  adp: number,
  overrides: Partial<{ fullName: string; position: string; nflTeam: string | null }> = {},
) {
  const player = await createTestPlayer({ nflTeam: "KC", ...overrides });
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
      expect(outcome.result.pick.leagueMemberId).toBe(draft.currentMemberId);
      const pickCount = await prisma.pick.count({ where: { draftId: draft.id } });
      expect(pickCount).toBe(1);
    });

    it("advances currentMemberId to the correct next picker", async () => {
      const { league, membershipsBySlot } = await startFullDraft({
        teamCount: 4,
        draftType: "SNAKE",
      });
      await createPlayerWithAdp(league.scoringFormat, 1);

      const outcome = await processExpiredDraftTurn(league.id);

      expect(outcome.outcome).toBe("picked");
      if (outcome.outcome !== "picked") throw new Error("unreachable");
      const expectedSlot = getPickerForPickNumber(2, 4, "SNAKE");
      expect(outcome.result.draft.currentMemberId).toBe(membershipsBySlot[expectedSlot]);
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
      const { league, owner, userIdByMembershipId, draft } = await startFullDraft({
        teamCount: 4,
        rosterSize: 1,
      });
      // rosterSize 1 * teamCount 4 = 4 total picks. Drive the first 3 via
      // manual submitPick, then let the final turn expire into autopick.
      let currentUserId = owner.id; // pick 1 always belongs to slot 1 (owner)
      for (let i = 0; i < 3; i++) {
        const player = await createPlayerWithAdp(league.scoringFormat, i + 1);
        const result = await submitPick(league.id, currentUserId, player.id);
        currentUserId = userIdByMembershipId[result.draft.currentMemberId!]!;
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
      expect(outcome.result.draft.currentMemberId).toBeNull();
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
      const { league, owner, draft } = await startFullDraft({ teamCount: 4 });
      const player = await createTestPlayer();
      await submitPick(league.id, owner.id, player.id);

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
      const { league, owner, userIdByMembershipId, draft } = await startFullDraft({
        teamCount: 4,
        rosterSize: 1,
      });
      let currentUserId = owner.id;
      for (let i = 0; i < 4; i++) {
        const player = await createTestPlayer();
        const result = await submitPick(league.id, currentUserId, player.id);
        if (result.draft.currentMemberId) {
          currentUserId = userIdByMembershipId[result.draft.currentMemberId]!;
        }
      }
      const completed = await prisma.draft.findUnique({ where: { id: draft.id } });
      expect(completed?.status).toBe("COMPLETE");

      const outcome = await processExpiredDraftTurn(league.id);

      expect(outcome).toEqual({ outcome: "skipped", leagueId: league.id, reason: "NOT_ACTIVE" });
    });
  });

  describe("concurrency", () => {
    it("a manual pick racing an expired-turn autopick results in exactly one accepted pick", async () => {
      const { league, owner, draft } = await startFullDraft({ teamCount: 4 });
      const manualPlayer = await createTestPlayer();
      await createPlayerWithAdp(league.scoringFormat, 1);

      const [manualOutcome, autoOutcome] = await Promise.allSettled([
        submitPick(league.id, owner.id, manualPlayer.id),
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

  // Ranking-rule coverage (best ADP wins, scoring-format sensitivity,
  // searchRank fallback, tiebreaks, rostered-only eligibility) lives in
  // player-selection.test.ts, against the extracted selectBestAvailablePlayerId
  // directly. What remains here proves the higher-level wiring: that
  // processExpiredDraftTurn actually calls the shared selector, applies its
  // result, still excludes drafted players end to end, and still surfaces
  // exhaustion as AutopickExhaustedError.
  describe("player selection (wiring)", () => {
    it("never selects a player already drafted in this draft", async () => {
      const { league, owner, draft } = await startFullDraft({ teamCount: 4 });
      const alreadyDrafted = await createPlayerWithAdp(league.scoringFormat, 1, {
        fullName: "Taken",
      });
      const nextBest = await createPlayerWithAdp(league.scoringFormat, 2, {
        fullName: "Next best",
      });
      await submitPick(league.id, owner.id, alreadyDrafted.id);
      await prisma.draft.update({
        where: { id: draft.id },
        data: { turnDeadline: new Date(Date.now() - 1_000) },
      });

      const outcome = await processExpiredDraftTurn(league.id);

      expect(outcome.outcome).toBe("picked");
      if (outcome.outcome !== "picked") throw new Error("unreachable");
      expect(outcome.result.pick.playerId).toBe(nextBest.id);
    });

    it("throws AutopickExhaustedError when no undrafted player exists", async () => {
      const { league } = await startFullDraft({ teamCount: 4 });

      await expect(processExpiredDraftTurn(league.id)).rejects.toBeInstanceOf(
        AutopickExhaustedError,
      );
    });
  });

  // Phase 5.3: processExpiredDraftTurn must never autopick for a BOT, even
  // if its (schema-identical, no-special-meaning) turnDeadline has expired.
  // This is the *authoritative* guard — it must hold regardless of what
  // findExpiredActiveDraftLeagueIds' own discovery-time filter saw, so this
  // test calls processExpiredDraftTurn directly rather than going through
  // discovery, proving the guard doesn't merely rely on never being called
  // for a BOT-current league.
  describe("BOT participant guard", () => {
    it("skips an expired turn whose current participant is a BOT, writing no Pick", async () => {
      const { draft } = await startDraftWithBotCurrent();

      const outcome = await processExpiredDraftTurn(draft.leagueId);

      expect(outcome).toEqual({
        outcome: "skipped",
        leagueId: draft.leagueId,
        reason: "CURRENT_PARTICIPANT_IS_BOT",
      });
      const pickCount = await prisma.pick.count({ where: { draftId: draft.id } });
      expect(pickCount).toBe(0);
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

  it("excludes an ACTIVE draft whose current participant is a BOT, even past its deadline", async () => {
    const { draft } = await startDraftWithBotCurrent();

    const ids = await findExpiredActiveDraftLeagueIds();

    expect(ids).not.toContain(draft.leagueId);
  });
});
