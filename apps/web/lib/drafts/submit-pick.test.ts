import { getPickerForPickNumber } from "@fdm/shared";
import {
  DraftNotActiveError,
  DraftNotFoundError,
  LeagueNotAccessibleError,
  NotOnTheClockError,
  PlayerAlreadyDraftedError,
  PlayerNotFoundError,
  Prisma,
  prisma,
  submitPick,
} from "@fdm/database";
import { cleanupLeagueTestData, createTestPlayer, createTestUser } from "@fdm/database/test-support";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createLeague } from "../leagues/create-league";
import { startDraft } from "./start-draft";

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
// Phase 5.1: returns the created LeagueMember rows too (not just the Users),
// since callers now need each slot's membershipId as well as its userId.
async function fillRemainingSlots(leagueId: string, teamCount: number) {
  const users = await Promise.all(Array.from({ length: teamCount - 1 }, () => createTestUser()));
  const members = await Promise.all(
    users.map((user, i) =>
      prisma.leagueMember.create({
        data: { leagueId, userId: user.id, draftSlot: i + 2 },
      }),
    ),
  );
  return users.map((user, i) => ({ user, membership: members[i]! }));
}

// Creates a fully-filled, started league and returns everything a
// pick-submission test needs: the league, a slot -> userId map and a
// slot -> membershipId map (so tests can assert persisted currentMemberId
// against expected turn order, or resolve a membershipId back to the
// userId submitPick's requestingUserId parameter needs, without
// duplicating getPickerForPickNumber's arithmetic), and the initial
// startDraft result.
//
// Phase 5.1: submitPick's requestingUserId parameter is still a real
// User.id (humans always authenticate that way — see submit-pick.ts's own
// comments), but Draft.currentMemberId/Pick.leagueMemberId are now
// membership ids, not user ids. userIdByMembershipId bridges the two for
// tests that track "the current picker" across a loop of many picks
// without recomputing getPickerForPickNumber themselves.
async function startFullDraft(overrides: LeagueOverrides = {}) {
  const teamCount = overrides.teamCount ?? 4;
  const owner = await createTestUser();
  const { league, membership: ownerMembership } = await createTestLeague(owner.id, overrides);
  const otherMembers = await fillRemainingSlots(league.id, teamCount);

  const membersBySlot: Record<number, string> = { 1: owner.id };
  const membershipsBySlot: Record<number, string> = { 1: ownerMembership.id };
  const userIdByMembershipId: Record<string, string> = { [ownerMembership.id]: owner.id };
  otherMembers.forEach(({ user, membership }, i) => {
    membersBySlot[i + 2] = user.id;
    membershipsBySlot[i + 2] = membership.id;
    userIdByMembershipId[membership.id] = user.id;
  });

  const started = await startDraft(league.id, owner.id);
  return {
    league,
    owner,
    membersBySlot,
    membershipsBySlot,
    userIdByMembershipId,
    draft: started.draft,
  };
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
      const notOnClock = membersBySlot[2]!;
      const player = await createTestPlayer();

      await expect(submitPick(league.id, notOnClock, player.id)).rejects.toBeInstanceOf(
        NotOnTheClockError,
      );

      const pickCount = await prisma.pick.count({ where: { draftId: draft.id } });
      expect(pickCount).toBe(0);
      const persisted = await prisma.draft.findUnique({ where: { id: draft.id } });
      expect(persisted?.currentPickNumber).toBe(1);
      expect(persisted?.currentMemberId).toBe(draft.currentMemberId);
    });

    it("rejects an unknown playerId, leaving Pick/Draft state unchanged", async () => {
      const { league, membersBySlot, draft } = await startFullDraft({ teamCount: 4 });

      await expect(
        submitPick(league.id, membersBySlot[1]!, "nonexistent-player-id"),
      ).rejects.toBeInstanceOf(PlayerNotFoundError);

      const pickCount = await prisma.pick.count({ where: { draftId: draft.id } });
      expect(pickCount).toBe(0);
      const persisted = await prisma.draft.findUnique({ where: { id: draft.id } });
      expect(persisted?.currentPickNumber).toBe(1);
    });

    it("rejects re-drafting an already-picked player, leaving Draft state at the next turn unchanged", async () => {
      const { league, membersBySlot, membershipsBySlot, draft } = await startFullDraft({
        teamCount: 4,
      });
      const player = await createTestPlayer();

      await submitPick(league.id, membersBySlot[1]!, player.id);

      const afterFirstPick = await prisma.draft.findUnique({ where: { id: draft.id } });
      expect(afterFirstPick?.currentPickNumber).toBe(2);
      const secondPickerMembershipId = afterFirstPick!.currentMemberId!;
      expect(secondPickerMembershipId).toBe(membershipsBySlot[2]);

      await expect(
        submitPick(league.id, membersBySlot[2]!, player.id),
      ).rejects.toBeInstanceOf(PlayerAlreadyDraftedError);

      const pickCount = await prisma.pick.count({ where: { draftId: draft.id } });
      expect(pickCount).toBe(1);
      const afterRejection = await prisma.draft.findUnique({ where: { id: draft.id } });
      expect(afterRejection?.currentPickNumber).toBe(2);
      expect(afterRejection?.currentMemberId).toBe(secondPickerMembershipId);
    });

    it("rejects a pick submitted against a COMPLETE draft, leaving state unchanged", async () => {
      // teamCount 4 * rosterSize 8 = 32 total picks; drive the draft to
      // completion, then attempt one more pick against the now-COMPLETE draft.
      const { league, membersBySlot, userIdByMembershipId, draft } = await startFullDraft({
        teamCount: 4,
        rosterSize: 8,
      });
      const totalPicks = 4 * 8;
      const players = await Promise.all(
        Array.from({ length: totalPicks }, () => createTestPlayer()),
      );

      let currentUserId = membersBySlot[1]!;
      for (let i = 0; i < totalPicks; i++) {
        const result = await submitPick(league.id, currentUserId, players[i]!.id);
        if (result.draft.currentMemberId) {
          currentUserId = userIdByMembershipId[result.draft.currentMemberId]!;
        }
      }

      const completed = await prisma.draft.findUnique({ where: { id: draft.id } });
      expect(completed?.status).toBe("COMPLETE");

      const extraPlayer = await createTestPlayer();
      await expect(
        submitPick(league.id, membersBySlot[1]!, extraPlayer.id),
      ).rejects.toBeInstanceOf(DraftNotActiveError);

      const pickCount = await prisma.pick.count({ where: { draftId: draft.id } });
      expect(pickCount).toBe(totalPicks);
    });
  });

  describe("successful submission", () => {
    it("persists wasAutopick: false and advances the deadline within a tolerance window", async () => {
      const { league, membersBySlot } = await startFullDraft({ teamCount: 4, timerSeconds: 90 });
      const player = await createTestPlayer();
      const before = Date.now();

      const result = await submitPick(league.id, membersBySlot[1]!, player.id);

      expect(result.pick.wasAutopick).toBe(false);
      expect(result.pick.pickNumber).toBe(1);
      expect(result.draft.currentPickNumber).toBe(2);

      const deadline = new Date(result.draft.turnDeadline!).getTime();
      expect(deadline).toBeGreaterThanOrEqual(before + 90_000);
      expect(deadline).toBeLessThan(before + 90_000 + 5_000);
    });

    it("advances currentMemberId through SNAKE round boundaries", async () => {
      const { league, membersBySlot, membershipsBySlot } = await startFullDraft({
        teamCount: 4,
        draftType: "SNAKE",
      });
      const players = await Promise.all(Array.from({ length: 9 }, () => createTestPlayer()));

      for (let pickNumber = 1; pickNumber <= 9; pickNumber++) {
        const slot = getPickerForPickNumber(pickNumber, 4, "SNAKE");
        const result = await submitPick(league.id, membersBySlot[slot]!, players[pickNumber - 1]!.id);
        if (pickNumber < 9) {
          const expectedSlot = getPickerForPickNumber(pickNumber + 1, 4, "SNAKE");
          expect(result.draft.currentMemberId).toBe(membershipsBySlot[expectedSlot]);
        }
      }
      // Crossed round boundaries 4->5 (reverses 4,3,2,1) and 8->9 (forward
      // again to slot 1), both asserted via the loop above.
    });

    it("advances currentMemberId through LINEAR round boundaries", async () => {
      const { league, membersBySlot, membershipsBySlot } = await startFullDraft({
        teamCount: 4,
        draftType: "LINEAR",
      });
      const players = await Promise.all(Array.from({ length: 5 }, () => createTestPlayer()));

      for (let pickNumber = 1; pickNumber <= 5; pickNumber++) {
        const slot = getPickerForPickNumber(pickNumber, 4, "LINEAR");
        const result = await submitPick(league.id, membersBySlot[slot]!, players[pickNumber - 1]!.id);
        if (pickNumber < 5) {
          const expectedSlot = getPickerForPickNumber(pickNumber + 1, 4, "LINEAR");
          expect(result.draft.currentMemberId).toBe(membershipsBySlot[expectedSlot]);
        }
      }
      // Pick 5 wraps LINEAR order back to slot 1, unlike SNAKE's reversal.
    });

    it("completes the draft on the final pick with the correct terminal state", async () => {
      const { league, membersBySlot, userIdByMembershipId, draft } = await startFullDraft({
        teamCount: 4,
        rosterSize: 8,
      });
      const totalPicks = 4 * 8;
      const players = await Promise.all(
        Array.from({ length: totalPicks }, () => createTestPlayer()),
      );

      let currentUserId = membersBySlot[1]!;
      let lastResult;
      for (let i = 0; i < totalPicks; i++) {
        lastResult = await submitPick(league.id, currentUserId, players[i]!.id);
        if (lastResult.draft.currentMemberId) {
          currentUserId = userIdByMembershipId[lastResult.draft.currentMemberId]!;
        }
      }

      expect(lastResult!.draft.status).toBe("COMPLETE");
      expect(lastResult!.draft.currentPickNumber).toBe(totalPicks);
      expect(lastResult!.draft.currentMemberId).toBeNull();
      expect(lastResult!.draft.turnDeadline).toBeNull();

      const persisted = await prisma.draft.findUnique({ where: { id: draft.id } });
      expect(persisted?.status).toBe("COMPLETE");
      expect(persisted?.currentPickNumber).toBe(totalPicks);
      expect(persisted?.currentMemberId).toBeNull();
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
      const { league, membersBySlot, membershipsBySlot, draft } = await startFullDraft({
        teamCount: 4,
      });
      const player = await createTestPlayer();

      const outcomes = await Promise.allSettled(
        Array.from({ length: CONCURRENT_REQUESTS }, () =>
          submitPick(league.id, membersBySlot[1]!, player.id),
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
      expect(persisted?.currentMemberId).toBe(membershipsBySlot[expectedNextSlot]);
    });

    it("under many simultaneous submissions for different players by the same current picker, exactly one consumes the turn", async () => {
      const { league, membersBySlot, draft } = await startFullDraft({ teamCount: 4 });
      const players = await Promise.all(
        Array.from({ length: CONCURRENT_REQUESTS }, () => createTestPlayer()),
      );

      const outcomes = await Promise.allSettled(
        players.map((player) => submitPick(league.id, membersBySlot[1]!, player.id)),
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
      const { draft, membershipsBySlot } = await startFullDraft({ teamCount: 4 });
      const player = await createTestPlayer();

      const outcomes = await Promise.allSettled([
        prisma.pick.create({
          data: {
            draftId: draft.id,
            pickNumber: 1,
            leagueMemberId: membershipsBySlot[1]!,
            playerId: player.id,
            wasAutopick: false,
          },
        }),
        prisma.pick.create({
          data: {
            draftId: draft.id,
            pickNumber: 2,
            leagueMemberId: membershipsBySlot[1]!,
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
      const target = uniqueConstraintFields(rejected[0]!.reason);
      expect(target).not.toBeNull();
      expect(target).toContain("draftId");
      expect(target).toContain("playerId");
      expect(target).not.toContain("pickNumber");

      const count = await prisma.pick.count({ where: { draftId: draft.id, playerId: player.id } });
      expect(count).toBe(1);
    });

    it("enforces @@unique([draftId, pickNumber]) under concurrent inserts with different playerIds", async () => {
      const { draft, membershipsBySlot } = await startFullDraft({ teamCount: 4 });
      const [playerA, playerB] = await Promise.all([createTestPlayer(), createTestPlayer()]);

      const outcomes = await Promise.allSettled([
        prisma.pick.create({
          data: {
            draftId: draft.id,
            pickNumber: 5,
            leagueMemberId: membershipsBySlot[1]!,
            playerId: playerA.id,
            wasAutopick: false,
          },
        }),
        prisma.pick.create({
          data: {
            draftId: draft.id,
            pickNumber: 5,
            leagueMemberId: membershipsBySlot[1]!,
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
      const target = uniqueConstraintFields(rejected[0]!.reason);
      expect(target).not.toBeNull();
      expect(target).toContain("draftId");
      expect(target).toContain("pickNumber");
      expect(target).not.toContain("playerId");

      const count = await prisma.pick.count({ where: { draftId: draft.id, pickNumber: 5 } });
      expect(count).toBe(1);
    });
  });
});
