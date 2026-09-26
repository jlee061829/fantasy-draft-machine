import { prisma } from "@fdm/database";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanupLeagueTestData, createTestUser } from "@fdm/database/test-support";
import { createLeague } from "./create-league";
import { generateInviteCode, INVITE_CODE_ALPHABET, INVITE_CODE_LENGTH } from "./invite-code";

// Wraps the real generateInviteCode by default (every existing test below
// keeps exercising real random generation) so an individual test can
// override it with mockReturnValueOnce to force a specific, otherwise
// astronomically unlikely, real invite-code collision.
vi.mock("./invite-code", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./invite-code")>();
  return { ...actual, generateInviteCode: vi.fn(actual.generateInviteCode) };
});

// Atomicity is a structural property of create-league.ts (a single
// prisma.$transaction call containing both writes, with no other code path
// that creates a League) rather than something forced and observed here —
// there's no realistic way to make the LeagueMember insert fail through this
// public interface, since draftSlot: 1 against a freshly generated leagueId
// can't collide with the (leagueId, draftSlot) unique constraint.
describe("createLeague", () => {
  beforeEach(async () => {
    await cleanupLeagueTestData();
  });

  afterEach(async () => {
    await cleanupLeagueTestData();
    vi.mocked(generateInviteCode).mockClear();
  });

  it("creates the league and the creator's membership atomically", async () => {
    const user = await createTestUser();

    const result = await createLeague(
      {
        name: "Integration League",
        rosterSize: 16,
        teamCount: 12,
        timerSeconds: 60,
        scoringFormat: "PPR",
        draftType: "SNAKE",
      },
      user.id,
    );

    expect(result.league.ownerId).toBe(user.id);
    expect(result.league.teamCount).toBe(12);
    expect(result.membership.draftSlot).toBe(1);

    const leagues = await prisma.league.findMany({ where: { ownerId: user.id } });
    expect(leagues).toHaveLength(1);
    expect(leagues[0]?.id).toBe(result.league.id);
    expect(leagues[0]?.teamCount).toBe(12);

    const memberships = await prisma.leagueMember.findMany({
      where: { leagueId: result.league.id },
    });
    expect(memberships).toHaveLength(1);
    expect(memberships[0]?.userId).toBe(user.id);
    expect(memberships[0]?.draftSlot).toBe(1);
  });

  it("generates a unique, well-formed invite code", async () => {
    const user = await createTestUser();
    const pattern = new RegExp(`^[${INVITE_CODE_ALPHABET}]{${INVITE_CODE_LENGTH}}$`);

    const result = await createLeague(
      {
        name: "Invite Code League",
        rosterSize: 16,
        teamCount: 12,
        timerSeconds: 60,
        scoringFormat: "PPR",
        draftType: "SNAKE",
      },
      user.id,
    );

    expect(result.league.inviteCode).toMatch(pattern);

    const league = await prisma.league.findUnique({ where: { id: result.league.id } });
    expect(league?.inviteCode).toBe(result.league.inviteCode);
  });

  // Phase 6.1 regression coverage: unlike the join/reorder P2002 paths (which
  // are structurally unreachable under their own row locks — see their own
  // test files), a real invite-code collision IS reachable through this
  // public function, since two createLeague() calls for two different
  // Leagues share no row lock with each other. Before this fix,
  // isInviteCodeCollision only checked error.meta.target, which this stack's
  // real Prisma 7 + @prisma/adapter-pg driver never populates — so a real
  // collision here would have thrown an unmapped error instead of retrying.
  // Forcing generateInviteCode to return an already-used code (rather than
  // hand-constructing a Prisma error) exercises the real database, the real
  // adapter, and the real error shape end to end.
  it("retries with a fresh code and succeeds when a real invite-code collision occurs", async () => {
    const firstOwner = await createTestUser();
    const secondOwner = await createTestUser();

    const first = await createLeague(
      {
        name: "First League",
        rosterSize: 16,
        teamCount: 12,
        timerSeconds: 60,
        scoringFormat: "PPR",
        draftType: "SNAKE",
      },
      firstOwner.id,
    );
    const collidingCode = first.league.inviteCode;
    const freshCode = collidingCode === "AAAAAAAA" ? "BBBBBBBB" : "AAAAAAAA";

    vi.mocked(generateInviteCode).mockReturnValueOnce(collidingCode).mockReturnValueOnce(freshCode);

    const second = await createLeague(
      {
        name: "Second League",
        rosterSize: 16,
        teamCount: 12,
        timerSeconds: 60,
        scoringFormat: "PPR",
        draftType: "SNAKE",
      },
      secondOwner.id,
    );

    expect(second.league.inviteCode).toBe(freshCode);
    expect(second.league.inviteCode).not.toBe(collidingCode);

    const leagues = await prisma.league.findMany({
      where: { id: { in: [first.league.id, second.league.id] } },
      select: { inviteCode: true },
    });
    expect(leagues.map((l) => l.inviteCode).sort()).toEqual([collidingCode, freshCode].sort());
  });
});
