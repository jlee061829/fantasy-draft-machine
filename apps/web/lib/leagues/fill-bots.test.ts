import {
  DraftAlreadyStartedError,
  LeagueFullError,
  LeagueNotAccessibleError,
  NotLeagueOwnerError,
  prisma,
} from "@fdm/database";
import { cleanupLeagueTestData, createTestUser } from "@fdm/database/test-support";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { startDraft } from "../drafts/start-draft";
import { createLeague } from "./create-league";
import { fillOpenLeagueSlotsWithBots } from "./fill-bots";
import { joinLeague } from "./join-league";

async function createTestLeague(ownerId: string, teamCount = 4) {
  return createLeague(
    {
      name: "Fill Bots Test League",
      rosterSize: 15,
      teamCount,
      timerSeconds: 60,
      scoringFormat: "PPR",
      draftType: "SNAKE",
    },
    ownerId,
  );
}

describe("fillOpenLeagueSlotsWithBots", () => {
  beforeEach(async () => {
    await cleanupLeagueTestData();
  });

  afterEach(async () => {
    await cleanupLeagueTestData();
  });

  it("fills every open slot with a BOT LeagueMember and returns the correct count", async () => {
    const owner = await createTestUser();
    const { league } = await createTestLeague(owner.id, 6);

    const result = await fillOpenLeagueSlotsWithBots(league.id, owner.id);

    expect(result.botsCreated).toBe(5);
    expect(result.members).toHaveLength(6);

    const bots = result.members.filter((m) => m.participantType === "BOT");
    expect(bots).toHaveLength(5);
    expect(bots.map((b) => b.draftSlot).sort((a, b) => a - b)).toEqual([2, 3, 4, 5, 6]);
    for (const bot of bots) {
      expect(bot.userId).toBeNull();
    }

    // The database CHECK constraint's own shape invariant, satisfied via the
    // real production service now, not only via createTestBotMember.
    const persistedBots = await prisma.leagueMember.findMany({
      where: { leagueId: league.id, participantType: "BOT" },
    });
    for (const bot of persistedBots) {
      expect(bot.userId).toBeNull();
      expect(bot.displayName).not.toBeNull();
    }
  });

  it("assigns deterministic ordinal names in ascending open-slot order, not slot-number-based names", async () => {
    const owner = await createTestUser();
    const { league } = await createTestLeague(owner.id, 6);
    // Owner occupies slot 1. Manually occupy slot 4, leaving open slots
    // {2, 3, 5, 6} — a non-contiguous gap, so slot number and ordinal
    // position diverge from each other.
    const gapFiller = await createTestUser();
    await prisma.leagueMember.create({
      data: { leagueId: league.id, userId: gapFiller.id, draftSlot: 4 },
    });

    const result = await fillOpenLeagueSlotsWithBots(league.id, owner.id);

    expect(result.botsCreated).toBe(4);
    const botsBySlot = new Map(
      result.members
        .filter((m) => m.participantType === "BOT")
        .map((m) => [m.draftSlot, m.name]),
    );
    expect(botsBySlot.get(2)).toBe("CPU 1");
    expect(botsBySlot.get(3)).toBe("CPU 2");
    expect(botsBySlot.get(5)).toBe("CPU 3");
    expect(botsBySlot.get(6)).toBe("CPU 4");
  });

  it("continues bot ordinals from the existing bot count rather than restarting at CPU 1", async () => {
    const owner = await createTestUser();
    const { league } = await createTestLeague(owner.id, 4);
    await fillOpenLeagueSlotsWithBots(league.id, owner.id); // CPU 1, CPU 2, CPU 3

    // Raise capacity so a new slot opens without any bot being removed.
    await prisma.league.update({ where: { id: league.id }, data: { teamCount: 5 } });

    const result = await fillOpenLeagueSlotsWithBots(league.id, owner.id);

    expect(result.botsCreated).toBe(1);
    const newBot = result.members.find((m) => m.draftSlot === 5);
    expect(newBot?.name).toBe("CPU 4");
  });

  it("succeeds with botsCreated: 0 when the league is already full — not a conflict", async () => {
    const owner = await createTestUser();
    const { league } = await createTestLeague(owner.id, 1);

    const result = await fillOpenLeagueSlotsWithBots(league.id, owner.id);

    expect(result.botsCreated).toBe(0);
    expect(result.members).toHaveLength(1);
  });

  it("leaves existing HUMAN memberships completely untouched", async () => {
    const owner = await createTestUser();
    const { league, membership: ownerMembership } = await createTestLeague(owner.id, 4);
    const joiner = await createTestUser();
    const { membership: joinerMembership } = await joinLeague(league.inviteCode, joiner.id);

    await fillOpenLeagueSlotsWithBots(league.id, owner.id);

    const humanRows = await prisma.leagueMember.findMany({
      where: { leagueId: league.id, participantType: "HUMAN" },
    });
    expect(humanRows).toHaveLength(2);
    expect(humanRows.map((m) => m.id).sort()).toEqual(
      [ownerMembership.id, joinerMembership.id].sort(),
    );
  });

  it("returns LeagueNotAccessibleError for a nonexistent league", async () => {
    const someone = await createTestUser();

    await expect(fillOpenLeagueSlotsWithBots("nonexistent-id", someone.id)).rejects.toBeInstanceOf(
      LeagueNotAccessibleError,
    );
  });

  it("returns LeagueNotAccessibleError for an authenticated non-member", async () => {
    const owner = await createTestUser();
    const outsider = await createTestUser();
    const { league } = await createTestLeague(owner.id);

    await expect(fillOpenLeagueSlotsWithBots(league.id, outsider.id)).rejects.toBeInstanceOf(
      LeagueNotAccessibleError,
    );
  });

  it("returns NotLeagueOwnerError for an authenticated non-owner member", async () => {
    const owner = await createTestUser();
    const { league } = await createTestLeague(owner.id);
    const joiner = await createTestUser();
    await joinLeague(league.inviteCode, joiner.id);

    await expect(fillOpenLeagueSlotsWithBots(league.id, joiner.id)).rejects.toBeInstanceOf(
      NotLeagueOwnerError,
    );
  });

  it("returns DraftAlreadyStartedError once a Draft exists, even for an otherwise-full league", async () => {
    const owner = await createTestUser();
    const { league } = await createTestLeague(owner.id, 2);
    const joiner = await createTestUser();
    await joinLeague(league.inviteCode, joiner.id);
    await startDraft(league.id, owner.id);

    await expect(fillOpenLeagueSlotsWithBots(league.id, owner.id)).rejects.toBeInstanceOf(
      DraftAlreadyStartedError,
    );
  });

  it("under two concurrent Fill calls, both resolve and final membership equals teamCount with no duplicate slots", async () => {
    const owner = await createTestUser();
    const { league } = await createTestLeague(owner.id, 12);

    const outcomes = await Promise.allSettled([
      fillOpenLeagueSlotsWithBots(league.id, owner.id),
      fillOpenLeagueSlotsWithBots(league.id, owner.id),
    ]);

    for (const outcome of outcomes) {
      expect(outcome.status).toBe("fulfilled");
    }

    const members = await prisma.leagueMember.findMany({
      where: { leagueId: league.id },
      select: { draftSlot: true },
    });
    expect(members).toHaveLength(12);
    const slots = members.map((m) => m.draftSlot).sort((a, b) => a - b);
    expect(slots).toEqual(Array.from({ length: 12 }, (_, i) => i + 1));
  });

  // Both fillOpenLeagueSlotsWithBots and joinLeague lock the same League row
  // (authorizeLeagueOwner and joinLeague's own SELECT ... FOR UPDATE
  // respectively), so exactly one of two valid outcomes must occur — never a
  // corrupted mix, never a displaced human, never a duplicate slot.
  it("under a concurrent HUMAN join vs Fill, resolves to exactly one of the two valid serialized outcomes", async () => {
    const owner = await createTestUser();
    const { league } = await createTestLeague(owner.id, 4);
    const joiner = await createTestUser();

    const [joinOutcome, fillOutcome] = await Promise.allSettled([
      joinLeague(league.inviteCode, joiner.id),
      fillOpenLeagueSlotsWithBots(league.id, owner.id),
    ]);

    // Fill is idempotent/race-safe by design and must always succeed.
    expect(fillOutcome.status).toBe("fulfilled");

    const members = await prisma.leagueMember.findMany({ where: { leagueId: league.id } });
    expect(members).toHaveLength(4);
    const botCount = members.filter((m) => m.participantType === "BOT").length;
    const joinerIsMember = members.some((m) => m.userId === joiner.id);

    if (joinOutcome.status === "fulfilled") {
      // The join landed first: fill only took the remaining 2 slots.
      expect(joinerIsMember).toBe(true);
      expect(botCount).toBe(2);
    } else {
      // Fill landed first and filled all 3 open slots; the join then saw a
      // full league.
      expect(joinOutcome.reason).toBeInstanceOf(LeagueFullError);
      expect(joinerIsMember).toBe(false);
      expect(botCount).toBe(3);
    }

    // No duplicate draft slots regardless of which outcome occurred.
    const slots = members.map((m) => m.draftSlot).sort((a, b) => a - b);
    expect(new Set(slots).size).toBe(slots.length);
  });
});
