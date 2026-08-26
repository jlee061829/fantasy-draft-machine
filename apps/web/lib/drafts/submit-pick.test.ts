import { getPickerForPickNumber } from "@fdm/shared";
import { Prisma, prisma } from "@fdm/database";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { cleanupLeagueTestData, createTestPlayer, createTestUser } from "../../test/db";
import { createLeague } from "../leagues/create-league";
import { LeagueNotAccessibleError } from "../leagues/errors";
import {
  DraftNotActiveError,
  DraftNotFoundError,
  NotOnTheClockError,
  PlayerAlreadyDraftedError,
  PlayerNotFoundError,
} from "./errors";
import { startDraft } from "./start-draft";
import { submitPick } from "./submit-pick";

interface LeagueOverrides {
  teamCount?: number;
  rosterSize?: number;
  timerSeconds?: number;
  draftType?: "SNAKE" | "LINEAR";
}

async function createTestLeague(ownerId: string, overrides: LeagueOverrides = {}) {
  return createLeague(
    {
      name: "Pick Submission Test League",
      rosterSize: overrides.rosterSize ?? 8,
      teamCount: overrides.teamCount ?? 4,
      timerSeconds: overrides.timerSeconds ?? 60,
      scoringFormat: "PPR",
      draftType: overrides.draftType ?? "SNAKE",
    },
    ownerId,
  );
}

// Owner already occupies slot 1 from league creation; fills slots 2..teamCount.
async function fillRemainingSlots(leagueId: string, teamCount: number) {
  const users = await Promise.all(Array.from({ length: teamCount - 1 }, () => createTestUser()));
  await Promise.all(
    users.map((user, i) =>
      prisma.leagueMember.create({
        data: { leagueId, userId: user.id, draftSlot: i + 2 },
      }),
    ),
  );
  return users;
}

// Creates a fully-filled, started league and returns everything a
// pick-submission test needs: the league, a slot -> userId map (so tests
// can assert persisted currentUserId against expected turn order without
// duplicating getPickerForPickNumber's arithmetic), and the initial
// startDraft result.
async function startFullDraft(overrides: LeagueOverrides = {}) {
  const teamCount = overrides.teamCount ?? 4;
  const owner = await createTestUser();
  const { league } = await createTestLeague(owner.id, overrides);
  const others = await fillRemainingSlots(league.id, teamCount);

  const membersBySlot: Record<number, string> = { 1: owner.id };
  others.forEach((user, i) => {
    membersBySlot[i + 2] = user.id;
  });

  const started = await startDraft(league.id, owner.id);
  return { league, owner, membersBySlot, draft: started.draft };
}

// Mirrors submit-pick.ts's uniqueConstraintFields: under this project's
// Prisma 7 + @prisma/adapter-pg setup, P2002's violated columns show up at
// error.meta.driverAdapterError.cause.constraint.fields (quoted), not the
// documented error.meta.target.
function uniqueConstraintFields(error: unknown): string[] | null {
  if (!(error instanceof Prisma.PrismaClientKnownRequestError) || error.code !== "P2002") {
    return null;
  }
  const meta = error.meta as
    | { target?: unknown; driverAdapterError?: { cause?: { constraint?: { fields?: unknown } } } }
    | undefined;
  if (Array.isArray(meta?.target)) {
    return meta.target as string[];
  }
  const fields = meta?.driverAdapterError?.cause?.constraint?.fields;
  if (Array.isArray(fields)) {
    return fields.map((field) => String(field).replace(/^"|"$/g, ""));
  }
  return null;
}

describe("submitPick", () => {
  beforeEach(async () => {
    await cleanupLeagueTestData();
  });

  afterEach(async () => {
    await cleanupLeagueTestData();
  });

  describe("accessibility and state errors", () => {
    it("rejects a nonexistent league", async () => {
      const someone = await createTestUser();
      const player = await createTestPlayer();

      await expect(
        submitPick("nonexistent-id", someone.id, player.id),
      ).rejects.toBeInstanceOf(LeagueNotAccessibleError);
    });

    it("rejects an authenticated non-member", async () => {
      const owner = await createTestUser();
      const { league } = await createTestLeague(owner.id);
      const outsider = await createTestUser();
      const player = await createTestPlayer();

      await expect(submitPick(league.id, outsider.id, player.id)).rejects.toBeInstanceOf(
        LeagueNotAccessibleError,
      );
    });

    it("rejects a member of a league that has no draft yet", async () => {
      const owner = await createTestUser();
      const { league } = await createTestLeague(owner.id, { teamCount: 4 });
      await fillRemainingSlots(league.id, 4);
      const player = await createTestPlayer();

      await expect(submitPick(league.id, owner.id, player.id)).rejects.toBeInstanceOf(
        DraftNotFoundError,
      );
    });

    it("rejects a member who is not the current picker, leaving Pick/Draft state unchanged", async () => {
      const { league, membersBySlot, draft } = await startFullDraft({ teamCount: 4 });
      const notOnClock = membersBySlot[2];
      const player = await createTestPlayer();

      await expect(submitPick(league.id, notOnClock, player.id)).rejects.toBeInstanceOf(
        NotOnTheClockError,
      );

      const pickCount = await prisma.pick.count({ where: { draftId: draft.id } });
      expect(pickCount).toBe(0);
      const persisted = await prisma.draft.findUnique({ where: { id: draft.id } });
      expect(persisted?.currentPickNumber).toBe(1);
      expect(persisted?.currentUserId).toBe(draft.currentUserId);
    });

    it("rejects an unknown playerId, leaving Pick/Draft state unchanged", async () => {
      const { league, draft } = await startFullDraft({ teamCount: 4 });

      await expect(
        submitPick(league.id, draft.currentUserId, "nonexistent-player-id"),
      ).rejects.toBeInstanceOf(PlayerNotFoundError);

      const pickCount = await prisma.pick.count({ where: { draftId: draft.id } });
      expect(pickCount).toBe(0);
      const persisted = await prisma.draft.findUnique({ where: { id: draft.id } });
      expect(persisted?.currentPickNumber).toBe(1);
    });

    it("rejects re-drafting an already-picked player, leaving Draft state at the next turn unchanged", async () => {
      const { league, membersBySlot, draft } = await startFullDraft({ teamCount: 4 });
      const player = await createTestPlayer();

      await submitPick(league.id, draft.currentUserId, player.id);

      const afterFirstPick = await prisma.draft.findUnique({ where: { id: draft.id } });
      expect(afterFirstPick?.currentPickNumber).toBe(2);
      const secondPicker = afterFirstPick!.currentUserId!;
      expect(secondPicker).toBe(membersBySlot[2]);

      await expect(submitPick(league.id, secondPicker, player.id)).rejects.toBeInstanceOf(
        PlayerAlreadyDraftedError,
      );

      const pickCount = await prisma.pick.count({ where: { draftId: draft.id } });
      expect(pickCount).toBe(1);
      const afterRejection = await prisma.draft.findUnique({ where: { id: draft.id } });
      expect(afterRejection?.currentPickNumber).toBe(2);
      expect(afterRejection?.currentUserId).toBe(secondPicker);
    });

    it("rejects a pick submitted against a COMPLETE draft, leaving state unchanged", async () => {
      // teamCount 4 * rosterSize 8 = 32 total picks; drive the draft to
      // completion, then attempt one more pick against the now-COMPLETE draft.
      const { league, membersBySlot, draft } = await startFullDraft({
        teamCount: 4,
        rosterSize: 8,
      });
      const totalPicks = 4 * 8;
      const players = await Promise.all(
        Array.from({ length: totalPicks }, () => createTestPlayer()),
      );

      let currentUserId = draft.currentUserId;
      for (let i = 0; i < totalPicks; i++) {
        const result = await submitPick(league.id, currentUserId, players[i].id);
        currentUserId = result.draft.currentUserId ?? currentUserId;
      }

      const completed = await prisma.draft.findUnique({ where: { id: draft.id } });
      expect(completed?.status).toBe("COMPLETE");

      const extraPlayer = await createTestPlayer();
      await expect(
        submitPick(league.id, membersBySlot[1], extraPlayer.id),
      ).rejects.toBeInstanceOf(DraftNotActiveError);

      const pickCount = await prisma.pick.count({ where: { draftId: draft.id } });
      expect(pickCount).toBe(totalPicks);
    });
  });

  describe("successful submission", () => {
    it("persists wasAutopick: false and advances the deadline within a tolerance window", async () => {
      const { league, draft } = await startFullDraft({ teamCount: 4, timerSeconds: 90 });
      const player = await createTestPlayer();
      const before = Date.now();

      const result = await submitPick(league.id, draft.currentUserId, player.id);

      expect(result.pick.wasAutopick).toBe(false);
      expect(result.pick.pickNumber).toBe(1);
      expect(result.draft.currentPickNumber).toBe(2);

      const deadline = new Date(result.draft.turnDeadline!).getTime();
      expect(deadline).toBeGreaterThanOrEqual(before + 90_000);
      expect(deadline).toBeLessThan(before + 90_000 + 5_000);
    });

    it("advances currentUserId through SNAKE round boundaries", async () => {
      const { league, membersBySlot, draft } = await startFullDraft({
        teamCount: 4,
        draftType: "SNAKE",
      });
      const players = await Promise.all(Array.from({ length: 9 }, () => createTestPlayer()));

      let currentUserId = draft.currentUserId;
      for (let pickNumber = 1; pickNumber <= 9; pickNumber++) {
        const result = await submitPick(league.id, currentUserId, players[pickNumber - 1].id);
        if (pickNumber < 9) {
          const expectedSlot = getPickerForPickNumber(pickNumber + 1, 4, "SNAKE");
          expect(result.draft.currentUserId).toBe(membersBySlot[expectedSlot]);
          currentUserId = result.draft.currentUserId!;
        }
      }
      // Crossed round boundaries 4->5 (reverses 4,3,2,1) and 8->9 (forward
      // again to slot 1), both asserted via the loop above.
    });

    it("advances currentUserId through LINEAR round boundaries", async () => {
      const { league, membersBySlot, draft } = await startFullDraft({
        teamCount: 4,
        draftType: "LINEAR",
      });
      const players = await Promise.all(Array.from({ length: 5 }, () => createTestPlayer()));

      let currentUserId = draft.currentUserId;
      for (let pickNumber = 1; pickNumber <= 5; pickNumber++) {
        const result = await submitPick(league.id, currentUserId, players[pickNumber - 1].id);
        if (pickNumber < 5) {
          const expectedSlot = getPickerForPickNumber(pickNumber + 1, 4, "LINEAR");
          expect(result.draft.currentUserId).toBe(membersBySlot[expectedSlot]);
          currentUserId = result.draft.currentUserId!;
        }
      }
      // Pick 5 wraps LINEAR order back to slot 1, unlike SNAKE's reversal.
    });

    it("completes the draft on the final pick with the correct terminal state", async () => {
      const { league, draft } = await startFullDraft({ teamCount: 4, rosterSize: 8 });
      const totalPicks = 4 * 8;
      const players = await Promise.all(
        Array.from({ length: totalPicks }, () => createTestPlayer()),
      );

      let currentUserId = draft.currentUserId;
      let lastResult;
      for (let i = 0; i < totalPicks; i++) {
        lastResult = await submitPick(league.id, currentUserId, players[i].id);
        currentUserId = lastResult.draft.currentUserId ?? currentUserId;
      }

      expect(lastResult!.draft.status).toBe("COMPLETE");
      expect(lastResult!.draft.currentPickNumber).toBe(totalPicks);
      expect(lastResult!.draft.currentUserId).toBeNull();
      expect(lastResult!.draft.turnDeadline).toBeNull();

      const persisted = await prisma.draft.findUnique({ where: { id: draft.id } });
      expect(persisted?.status).toBe("COMPLETE");
      expect(persisted?.currentPickNumber).toBe(totalPicks);
      expect(persisted?.currentUserId).toBeNull();
      expect(persisted?.turnDeadline).toBeNull();

      const picks = await prisma.pick.findMany({ where: { draftId: draft.id } });
      expect(picks).toHaveLength(totalPicks);
      const pickNumbers = new Set(picks.map((p) => p.pickNumber));
      expect(pickNumbers.size).toBe(totalPicks);
    });
  });

  describe("service-level concurrency", () => {
    const CONCURRENT_REQUESTS = 20;

    it("under many simultaneous submissions for the same turn/player, exactly one Pick persists and the turn advances exactly once", async () => {
      const { league, membersBySlot, draft } = await startFullDraft({ teamCount: 4 });
      const player = await createTestPlayer();

      const outcomes = await Promise.allSettled(
        Array.from({ length: CONCURRENT_REQUESTS }, () =>
          submitPick(league.id, draft.currentUserId, player.id),
        ),
      );

      const fulfilled = outcomes.filter((o) => o.status === "fulfilled");
      const rejected = outcomes.filter(
        (o): o is PromiseRejectedResult => o.status === "rejected",
      );
      expect(fulfilled).toHaveLength(1);
      expect(rejected).toHaveLength(CONCURRENT_REQUESTS - 1);
      for (const r of rejected) {
        expect(r.reason).toBeInstanceOf(NotOnTheClockError);
      }

      const pickCount = await prisma.pick.count({ where: { draftId: draft.id } });
      expect(pickCount).toBe(1);

      const persisted = await prisma.draft.findUnique({ where: { id: draft.id } });
      expect(persisted?.currentPickNumber).toBe(2);
      const expectedNextSlot = getPickerForPickNumber(2, 4, "SNAKE");
      expect(persisted?.currentUserId).toBe(membersBySlot[expectedNextSlot]);
    });

    it("under many simultaneous submissions for different players by the same current picker, exactly one consumes the turn", async () => {
      const { league, draft } = await startFullDraft({ teamCount: 4 });
      const players = await Promise.all(
        Array.from({ length: CONCURRENT_REQUESTS }, () => createTestPlayer()),
      );

      const outcomes = await Promise.allSettled(
        players.map((player) => submitPick(league.id, draft.currentUserId, player.id)),
      );

      const fulfilled = outcomes.filter((o) => o.status === "fulfilled");
      const rejected = outcomes.filter(
        (o): o is PromiseRejectedResult => o.status === "rejected",
      );
      expect(fulfilled).toHaveLength(1);
      for (const r of rejected) {
        expect(r.reason).toBeInstanceOf(NotOnTheClockError);
      }

      const pickCount = await prisma.pick.count({ where: { draftId: draft.id } });
      expect(pickCount).toBe(1);
      const persisted = await prisma.draft.findUnique({ where: { id: draft.id } });
      expect(persisted?.currentPickNumber).toBe(2);
    });
  });

  describe("database constraint backstops", () => {
    it("enforces @@unique([draftId, playerId]) under concurrent inserts with different pickNumbers", async () => {
      const { draft, membersBySlot } = await startFullDraft({ teamCount: 4 });
      const player = await createTestPlayer();

      const outcomes = await Promise.allSettled([
        prisma.pick.create({
          data: {
            draftId: draft.id,
            pickNumber: 1,
            userId: membersBySlot[1],
            playerId: player.id,
            wasAutopick: false,
          },
        }),
        prisma.pick.create({
          data: {
            draftId: draft.id,
            pickNumber: 2,
            userId: membersBySlot[1],
            playerId: player.id,
            wasAutopick: false,
          },
        }),
      ]);

      const fulfilled = outcomes.filter((o) => o.status === "fulfilled");
      const rejected = outcomes.filter(
        (o): o is PromiseRejectedResult => o.status === "rejected",
      );
      expect(fulfilled).toHaveLength(1);
      expect(rejected).toHaveLength(1);
      const target = uniqueConstraintFields(rejected[0].reason);
      expect(target).not.toBeNull();
      expect(target).toContain("draftId");
      expect(target).toContain("playerId");
      expect(target).not.toContain("pickNumber");

      const count = await prisma.pick.count({ where: { draftId: draft.id, playerId: player.id } });
      expect(count).toBe(1);
    });

    it("enforces @@unique([draftId, pickNumber]) under concurrent inserts with different playerIds", async () => {
      const { draft, membersBySlot } = await startFullDraft({ teamCount: 4 });
      const [playerA, playerB] = await Promise.all([createTestPlayer(), createTestPlayer()]);

      const outcomes = await Promise.allSettled([
        prisma.pick.create({
          data: {
            draftId: draft.id,
            pickNumber: 5,
            userId: membersBySlot[1],
            playerId: playerA.id,
            wasAutopick: false,
          },
        }),
        prisma.pick.create({
          data: {
            draftId: draft.id,
            pickNumber: 5,
            userId: membersBySlot[1],
            playerId: playerB.id,
            wasAutopick: false,
          },
        }),
      ]);

      const fulfilled = outcomes.filter((o) => o.status === "fulfilled");
      const rejected = outcomes.filter(
        (o): o is PromiseRejectedResult => o.status === "rejected",
      );
      expect(fulfilled).toHaveLength(1);
      expect(rejected).toHaveLength(1);
      const target = uniqueConstraintFields(rejected[0].reason);
      expect(target).not.toBeNull();
      expect(target).toContain("draftId");
      expect(target).toContain("pickNumber");
      expect(target).not.toContain("playerId");

      const count = await prisma.pick.count({ where: { draftId: draft.id, pickNumber: 5 } });
      expect(count).toBe(1);
    });
  });
});
