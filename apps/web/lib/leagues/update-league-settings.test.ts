import { prisma } from "@fdm/database";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { cleanupLeagueTestData, createTestUser } from "../../test/db";
import { DraftAlreadyStartedError } from "../drafts/errors";
import { startDraft } from "../drafts/start-draft";
import { createLeague } from "./create-league";
import { LeagueNotAccessibleError, NotLeagueOwnerError, TeamCountBelowMembershipError } from "./errors";
import { updateLeagueSettings } from "./update-league-settings";

async function createTestLeague(ownerId: string, teamCount = 12) {
  return createLeague(
    {
      name: "Settings Test League",
      rosterSize: 16,
      teamCount,
      timerSeconds: 60,
      scoringFormat: "PPR",
      draftType: "SNAKE",
    },
    ownerId,
  );
}

describe("updateLeagueSettings", () => {
  beforeEach(async () => {
    await cleanupLeagueTestData();
  });

  afterEach(async () => {
    await cleanupLeagueTestData();
  });

  it("lets the owner update each field individually", async () => {
    const owner = await createTestUser();
    const { league } = await createTestLeague(owner.id);

    const result = await updateLeagueSettings(league.id, { name: "Renamed League" }, owner.id);
    expect(result.league.name).toBe("Renamed League");

    await updateLeagueSettings(league.id, { rosterSize: 20 }, owner.id);
    await updateLeagueSettings(league.id, { timerSeconds: 90 }, owner.id);
    await updateLeagueSettings(league.id, { scoringFormat: "STANDARD" }, owner.id);
    const final = await updateLeagueSettings(league.id, { draftType: "LINEAR" }, owner.id);

    expect(final.league).toMatchObject({
      name: "Renamed League",
      rosterSize: 20,
      timerSeconds: 90,
      scoringFormat: "STANDARD",
      draftType: "LINEAR",
    });
  });

  it("lets the owner update multiple fields in one call", async () => {
    const owner = await createTestUser();
    const { league } = await createTestLeague(owner.id);

    const result = await updateLeagueSettings(
      league.id,
      { name: "Combo League", timerSeconds: 45 },
      owner.id,
    );

    expect(result.league.name).toBe("Combo League");
    expect(result.league.timerSeconds).toBe(45);
  });

  it("leaves omitted fields unchanged after a partial update", async () => {
    const owner = await createTestUser();
    const { league } = await createTestLeague(owner.id);

    const result = await updateLeagueSettings(league.id, { name: "Only Name Changed" }, owner.id);

    expect(result.league.name).toBe("Only Name Changed");
    expect(result.league.rosterSize).toBe(16);
    expect(result.league.timerSeconds).toBe(60);
    expect(result.league.scoringFormat).toBe("PPR");
    expect(result.league.draftType).toBe("SNAKE");
  });

  it("rejects a non-owner member with NotLeagueOwnerError", async () => {
    const owner = await createTestUser();
    const member = await createTestUser();
    const { league } = await createTestLeague(owner.id);
    await prisma.leagueMember.create({
      data: { leagueId: league.id, userId: member.id, draftSlot: 2 },
    });

    await expect(
      updateLeagueSettings(league.id, { name: "Hijacked" }, member.id),
    ).rejects.toBeInstanceOf(NotLeagueOwnerError);
  });

  it("rejects an authenticated non-member with LeagueNotAccessibleError", async () => {
    const owner = await createTestUser();
    const outsider = await createTestUser();
    const { league } = await createTestLeague(owner.id);

    await expect(
      updateLeagueSettings(league.id, { name: "Hijacked" }, outsider.id),
    ).rejects.toBeInstanceOf(LeagueNotAccessibleError);
  });

  it("rejects a nonexistent league with LeagueNotAccessibleError", async () => {
    const someone = await createTestUser();

    await expect(
      updateLeagueSettings("nonexistent-league-id", { name: "Hijacked" }, someone.id),
    ).rejects.toBeInstanceOf(LeagueNotAccessibleError);
  });

  it("rejects lowering teamCount below the current member count", async () => {
    const owner = await createTestUser();
    const { league } = await createTestLeague(owner.id, 4);
    const joiners = await Promise.all([createTestUser(), createTestUser()]);
    for (const joiner of joiners) {
      await prisma.leagueMember.create({
        data: { leagueId: league.id, userId: joiner.id, draftSlot: joiners.indexOf(joiner) + 2 },
      });
    }
    // 3 members now occupy slots {1,2,3}.

    await expect(
      updateLeagueSettings(league.id, { teamCount: 2 }, owner.id),
    ).rejects.toBeInstanceOf(TeamCountBelowMembershipError);

    const unchanged = await prisma.league.findUnique({ where: { id: league.id } });
    expect(unchanged?.teamCount).toBe(4);
  });

  it("rejects lowering teamCount below the highest occupied draft slot even when memberCount allows it", async () => {
    const owner = await createTestUser();
    const { league } = await createTestLeague(owner.id, 4);
    const memberAtSlot4 = await createTestUser();
    await prisma.leagueMember.create({
      data: { leagueId: league.id, userId: memberAtSlot4.id, draftSlot: 4 },
    });
    // 2 members total, occupied slots {1, 4} - slot 2/3 are gaps.

    await expect(
      updateLeagueSettings(league.id, { teamCount: 3 }, owner.id),
    ).rejects.toBeInstanceOf(TeamCountBelowMembershipError);

    const unchanged = await prisma.league.findUnique({ where: { id: league.id } });
    expect(unchanged?.teamCount).toBe(4);
  });

  it("allows increasing teamCount within bounds", async () => {
    const owner = await createTestUser();
    const { league } = await createTestLeague(owner.id, 4);

    const result = await updateLeagueSettings(league.id, { teamCount: 20 }, owner.id);

    expect(result.league.teamCount).toBe(20);
  });

  it("rejects settings changes once a Draft exists and leaves the league unchanged", async () => {
    const owner = await createTestUser();
    const { league } = await createTestLeague(owner.id, 4);
    const joiners = await Promise.all([createTestUser(), createTestUser(), createTestUser()]);
    for (let i = 0; i < joiners.length; i++) {
      await prisma.leagueMember.create({
        data: { leagueId: league.id, userId: joiners[i]!.id, draftSlot: i + 2 },
      });
    }
    await startDraft(league.id, owner.id);

    await expect(
      updateLeagueSettings(league.id, { name: "Locked League" }, owner.id),
    ).rejects.toBeInstanceOf(DraftAlreadyStartedError);

    const unchanged = await prisma.league.findUnique({ where: { id: league.id } });
    expect(unchanged?.name).toBe("Settings Test League");
  });
});
