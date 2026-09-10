import {
  DraftAlreadyStartedError,
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
import { removeBotLeagueMembers } from "./remove-bots";

async function createTestLeague(ownerId: string, teamCount = 4) {
  return createLeague(
    {
      name: "Remove Bots Test League",
      rosterSize: 15,
      teamCount,
      timerSeconds: 60,
      scoringFormat: "PPR",
      draftType: "SNAKE",
    },
    ownerId,
  );
}

describe("removeBotLeagueMembers", () => {
  beforeEach(async () => {
    await cleanupLeagueTestData();
  });

  afterEach(async () => {
    await cleanupLeagueTestData();
  });

  it("removes only BOT LeagueMembers, leaving HUMAN rows untouched", async () => {
    const owner = await createTestUser();
    const { league, membership: ownerMembership } = await createTestLeague(owner.id, 4);
    const joiner = await createTestUser();
    const { membership: joinerMembership } = await joinLeague(league.inviteCode, joiner.id);
    await fillOpenLeagueSlotsWithBots(league.id, owner.id); // 2 bots, slots 3 and 4

    const result = await removeBotLeagueMembers(league.id, owner.id);

    expect(result.botsRemoved).toBe(2);
    expect(result.members).toHaveLength(2);
    expect(result.members.every((m) => m.participantType === "HUMAN")).toBe(true);

    const remaining = await prisma.leagueMember.findMany({ where: { leagueId: league.id } });
    expect(remaining).toHaveLength(2);
    expect(remaining.map((m) => m.id).sort()).toEqual(
      [ownerMembership.id, joinerMembership.id].sort(),
    );
    // HUMAN rows are byte-for-byte untouched — same slots as before removal.
    const ownerRow = remaining.find((m) => m.id === ownerMembership.id);
    const joinerRow = remaining.find((m) => m.id === joinerMembership.id);
    expect(ownerRow?.draftSlot).toBe(1);
    expect(joinerRow?.draftSlot).toBe(2);
  });

  it("succeeds with botsRemoved: 0 when no bots exist", async () => {
    const owner = await createTestUser();
    const { league } = await createTestLeague(owner.id, 4);

    const result = await removeBotLeagueMembers(league.id, owner.id);

    expect(result.botsRemoved).toBe(0);
    expect(result.members).toHaveLength(1);
  });

  it("reopens freed slots so a subsequent join can reuse the lowest one", async () => {
    const owner = await createTestUser();
    const { league } = await createTestLeague(owner.id, 4);
    await fillOpenLeagueSlotsWithBots(league.id, owner.id); // bots at slots 2, 3, 4

    await removeBotLeagueMembers(league.id, owner.id);

    const joiner = await createTestUser();
    const { membership } = await joinLeague(league.inviteCode, joiner.id);
    expect(membership.draftSlot).toBe(2);
  });

  it("reopens freed slots so a subsequent Fill can refill them", async () => {
    const owner = await createTestUser();
    const { league } = await createTestLeague(owner.id, 4);
    await fillOpenLeagueSlotsWithBots(league.id, owner.id);

    await removeBotLeagueMembers(league.id, owner.id);
    const result = await fillOpenLeagueSlotsWithBots(league.id, owner.id);

    expect(result.botsCreated).toBe(3);
    expect(result.members).toHaveLength(4);
    // Ordinal naming restarts from zero remaining bots after a full removal.
    const names = result.members
      .filter((m) => m.participantType === "BOT")
      .map((m) => m.name)
      .sort();
    expect(names).toEqual(["CPU 1", "CPU 2", "CPU 3"]);
  });

  it("returns LeagueNotAccessibleError for a nonexistent league", async () => {
    const someone = await createTestUser();

    await expect(removeBotLeagueMembers("nonexistent-id", someone.id)).rejects.toBeInstanceOf(
      LeagueNotAccessibleError,
    );
  });

  it("returns LeagueNotAccessibleError for an authenticated non-member", async () => {
    const owner = await createTestUser();
    const outsider = await createTestUser();
    const { league } = await createTestLeague(owner.id);

    await expect(removeBotLeagueMembers(league.id, outsider.id)).rejects.toBeInstanceOf(
      LeagueNotAccessibleError,
    );
  });

  it("returns NotLeagueOwnerError for an authenticated non-owner member", async () => {
    const owner = await createTestUser();
    const { league } = await createTestLeague(owner.id);
    const joiner = await createTestUser();
    await joinLeague(league.inviteCode, joiner.id);

    await expect(removeBotLeagueMembers(league.id, joiner.id)).rejects.toBeInstanceOf(
      NotLeagueOwnerError,
    );
  });

  it("returns DraftAlreadyStartedError once a Draft exists", async () => {
    const owner = await createTestUser();
    const { league } = await createTestLeague(owner.id, 2);
    const joiner = await createTestUser();
    await joinLeague(league.inviteCode, joiner.id);
    await startDraft(league.id, owner.id);

    await expect(removeBotLeagueMembers(league.id, owner.id)).rejects.toBeInstanceOf(
      DraftAlreadyStartedError,
    );
  });
});
