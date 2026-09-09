import { randomUUID } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { Prisma } from "../generated/prisma/client.js";
import { prisma } from "../client.js";
import { cleanupLeagueTestData, createTestBotMember, createTestUser } from "../test-support/db.js";

// Phase 5.1: real-Postgres verification of the participant-shape data
// model — the CHECK constraint added by hand in this feature's migration
// (Prisma 7.9.1 has no `@@check` schema DSL, so this invariant is entirely
// a database-level guarantee, not something TypeScript enforces) and the
// NULL-distinct unique-index behavior multiple BOT rows depend on. None of
// this goes through a service layer (no bot-creation service exists yet in
// 5.1) — these are direct Prisma calls against the schema itself.

async function createTestLeague(ownerId: string, teamCount = 4) {
  return prisma.league.create({
    data: {
      name: "Participant Shape Test League",
      ownerId,
      rosterSize: 8,
      teamCount,
      inviteCode: randomUUID().replace(/-/g, "").slice(0, 8).toUpperCase(),
      timerSeconds: 60,
      scoringFormat: "PPR",
      draftType: "SNAKE",
    },
  });
}

describe("LeagueMember participant-shape invariants", () => {
  beforeEach(async () => {
    await cleanupLeagueTestData();
  });

  afterEach(async () => {
    await cleanupLeagueTestData();
  });

  describe("valid shapes", () => {
    it("accepts a HUMAN row (userId set, displayName null)", async () => {
      const owner = await createTestUser();
      const league = await createTestLeague(owner.id);

      const member = await prisma.leagueMember.create({
        data: { leagueId: league.id, userId: owner.id, draftSlot: 1 },
      });

      expect(member.participantType).toBe("HUMAN");
      expect(member.userId).toBe(owner.id);
      expect(member.displayName).toBeNull();
    });

    it("accepts a BOT row (userId null, displayName set) with no User row involved", async () => {
      const owner = await createTestUser();
      const league = await createTestLeague(owner.id);

      const bot = await createTestBotMember(league.id, 2, { displayName: "CPU 1" });

      expect(bot.participantType).toBe("BOT");
      expect(bot.userId).toBeNull();
      expect(bot.displayName).toBe("CPU 1");
    });

    it("allows multiple BOT rows (each userId = NULL) to coexist in one league under @@unique([leagueId, userId])", async () => {
      const owner = await createTestUser();
      const league = await createTestLeague(owner.id, 4);
      await prisma.leagueMember.create({
        data: { leagueId: league.id, userId: owner.id, draftSlot: 1 },
      });

      // PostgreSQL's standard (non-version-gated) unique-index behavior
      // treats every NULL as distinct from every other NULL, so this must
      // NOT throw — verified here against the real test database rather
      // than assumed from documentation.
      const botA = await createTestBotMember(league.id, 2, { displayName: "CPU 1" });
      const botB = await createTestBotMember(league.id, 3, { displayName: "CPU 2" });
      const botC = await createTestBotMember(league.id, 4, { displayName: "CPU 3" });

      const members = await prisma.leagueMember.findMany({ where: { leagueId: league.id } });
      expect(members).toHaveLength(4);
      expect(new Set([botA.id, botB.id, botC.id]).size).toBe(3);
    });
  });

  describe("invalid shapes rejected by the participant-shape CHECK constraint", () => {
    it("rejects HUMAN with a null userId", async () => {
      const owner = await createTestUser();
      const league = await createTestLeague(owner.id);

      await expect(
        prisma.leagueMember.create({
          data: {
            leagueId: league.id,
            draftSlot: 1,
            participantType: "HUMAN",
            userId: null,
          },
        }),
      ).rejects.toThrow();
    });

    it("rejects HUMAN with a non-null displayName", async () => {
      const owner = await createTestUser();
      const league = await createTestLeague(owner.id);

      await expect(
        prisma.leagueMember.create({
          data: {
            leagueId: league.id,
            draftSlot: 1,
            participantType: "HUMAN",
            userId: owner.id,
            displayName: "Should not be allowed",
          },
        }),
      ).rejects.toThrow();
    });

    it("rejects BOT with a non-null userId", async () => {
      const owner = await createTestUser();
      const league = await createTestLeague(owner.id);

      await expect(
        prisma.leagueMember.create({
          data: {
            leagueId: league.id,
            draftSlot: 1,
            participantType: "BOT",
            userId: owner.id,
            displayName: "CPU 1",
          },
        }),
      ).rejects.toThrow();
    });

    it("rejects BOT with a null displayName", async () => {
      const owner = await createTestUser();
      const league = await createTestLeague(owner.id);

      await expect(
        prisma.leagueMember.create({
          data: {
            leagueId: league.id,
            draftSlot: 1,
            participantType: "BOT",
            userId: null,
            displayName: null,
          },
        }),
      ).rejects.toThrow();
    });

    it("surfaces the CHECK violation as a recognizable Postgres constraint error, not a silently-succeeded write", async () => {
      const owner = await createTestUser();
      const league = await createTestLeague(owner.id);

      let caught: unknown;
      try {
        await prisma.leagueMember.create({
          data: {
            leagueId: league.id,
            draftSlot: 1,
            participantType: "BOT",
            userId: owner.id,
            displayName: "CPU 1",
          },
        });
      } catch (error) {
        caught = error;
      }

      expect(caught).toBeInstanceOf(Prisma.PrismaClientKnownRequestError);
      // Empirically verified against this project's actual Prisma 7 +
      // @prisma/adapter-pg stack (the same stack whose P2002 metadata shape
      // required the driverAdapterError fallback documented in
      // submit-pick.ts): a CHECK violation surfaces as P2010 ("raw query
      // failed") with the underlying Postgres constraint name still present
      // in the error, rather than any dedicated "check constraint" code.
      const message = String((caught as { message?: unknown })?.message ?? "");
      expect(message).toContain("LeagueMember_participant_shape_check");

      const count = await prisma.leagueMember.count({ where: { leagueId: league.id } });
      expect(count).toBe(0);
    });
  });

  describe("unrelated invariants remain unaffected by the participant-shape change", () => {
    it("still rejects a duplicate human membership via @@unique([leagueId, userId])", async () => {
      const owner = await createTestUser();
      const league = await createTestLeague(owner.id);
      await prisma.leagueMember.create({
        data: { leagueId: league.id, userId: owner.id, draftSlot: 1 },
      });

      await expect(
        prisma.leagueMember.create({
          data: { leagueId: league.id, userId: owner.id, draftSlot: 2 },
        }),
      ).rejects.toBeInstanceOf(Prisma.PrismaClientKnownRequestError);
    });

    it("still rejects a duplicate draftSlot regardless of participant type via @@unique([leagueId, draftSlot])", async () => {
      const owner = await createTestUser();
      const league = await createTestLeague(owner.id);
      await prisma.leagueMember.create({
        data: { leagueId: league.id, userId: owner.id, draftSlot: 1 },
      });

      await expect(createTestBotMember(league.id, 1, { displayName: "CPU 1" })).rejects.toBeInstanceOf(
        Prisma.PrismaClientKnownRequestError,
      );
    });
  });
});
