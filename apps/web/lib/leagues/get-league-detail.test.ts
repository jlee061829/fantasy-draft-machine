import { prisma } from "@fdm/database";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { cleanupLeagueTestData, createTestUser } from "@fdm/database/test-support";
import { createLeague } from "./create-league";
import { getLeagueDetail } from "./get-league-detail";
import { startDraft } from "../drafts/start-draft";

async function createTestLeague(ownerId: string, teamCount = 12) {
  return createLeague(
    {
      name: "Detail Test League",
      rosterSize: 16,
      teamCount,
      timerSeconds: 60,
      scoringFormat: "PPR",
      draftType: "SNAKE",
    },
    ownerId,
  );
}

describe("getLeagueDetail", () => {
  beforeEach(async () => {
    await cleanupLeagueTestData();
  });

  afterEach(async () => {
    await cleanupLeagueTestData();
  });

  it("returns the full DTO for the owner", async () => {
    const owner = await createTestUser({ name: "Owner Person" });
    const { league } = await createTestLeague(owner.id, 8);

    const result = await getLeagueDetail(league.id, owner.id);

    expect(result).not.toBeNull();
    expect(result?.league).toEqual({
      id: league.id,
      name: "Detail Test League",
      ownerId: owner.id,
      rosterSize: 16,
      teamCount: 8,
      timerSeconds: 60,
      scoringFormat: "PPR",
      draftType: "SNAKE",
      inviteCode: league.inviteCode,
      createdAt: league.createdAt,
    });
    expect(result?.owner).toEqual({ id: owner.id, name: "Owner Person", image: null });
  });

  it("returns the DTO for a non-owner member", async () => {
    const owner = await createTestUser();
    const joiner = await createTestUser({ name: "Second Member" });
    const { league } = await createTestLeague(owner.id);

    await prisma.leagueMember.create({
      data: { leagueId: league.id, userId: joiner.id, draftSlot: 2 },
    });

    const result = await getLeagueDetail(league.id, joiner.id);

    expect(result).not.toBeNull();
    expect(result?.league.id).toBe(league.id);
    expect(result?.members.some((m) => m.userId === joiner.id && m.name === "Second Member")).toBe(
      true,
    );
  });

  it("returns null for an authenticated non-member", async () => {
    const owner = await createTestUser();
    const outsider = await createTestUser();
    const { league } = await createTestLeague(owner.id);

    const result = await getLeagueDetail(league.id, outsider.id);

    expect(result).toBeNull();
  });

  it("returns null for a nonexistent league", async () => {
    const someone = await createTestUser();

    const result = await getLeagueDetail("nonexistent-league-id", someone.id);

    expect(result).toBeNull();
  });

  it("orders members by draftSlot ascending regardless of insertion order", async () => {
    const owner = await createTestUser();
    const { league } = await createTestLeague(owner.id, 6);

    const memberAtSlot4 = await createTestUser();
    const memberAtSlot2 = await createTestUser();
    await prisma.leagueMember.create({
      data: { leagueId: league.id, userId: memberAtSlot4.id, draftSlot: 4 },
    });
    await prisma.leagueMember.create({
      data: { leagueId: league.id, userId: memberAtSlot2.id, draftSlot: 2 },
    });

    const result = await getLeagueDetail(league.id, owner.id);

    expect(result?.members.map((m) => m.draftSlot)).toEqual([1, 2, 4]);
  });

  it("exposes only safe user fields on owner and members", async () => {
    const owner = await createTestUser();
    const { league } = await createTestLeague(owner.id);

    const result = await getLeagueDetail(league.id, owner.id);

    expect(Object.keys(result!.owner).sort()).toEqual(["id", "image", "name"]);
    expect(Object.keys(result!.members[0]!).sort()).toEqual([
      "draftSlot",
      "image",
      "membershipId",
      "name",
      "userId",
    ]);
  });

  it("includes the invite code for a non-owner member", async () => {
    const owner = await createTestUser();
    const joiner = await createTestUser();
    const { league } = await createTestLeague(owner.id);
    await prisma.leagueMember.create({
      data: { leagueId: league.id, userId: joiner.id, draftSlot: 2 },
    });

    const result = await getLeagueDetail(league.id, joiner.id);

    expect(result?.league.inviteCode).toBe(league.inviteCode);
  });

  it("returns draft: null when no Draft exists", async () => {
    const owner = await createTestUser();
    const { league } = await createTestLeague(owner.id);

    const result = await getLeagueDetail(league.id, owner.id);

    expect(result?.draft).toBeNull();
  });

  it("returns the Draft id once a Draft exists", async () => {
    const owner = await createTestUser();
    const { league } = await createTestLeague(owner.id, 4);
    const otherUsers = await Promise.all([createTestUser(), createTestUser(), createTestUser()]);
    await Promise.all(
      otherUsers.map((user, i) =>
        prisma.leagueMember.create({
          data: { leagueId: league.id, userId: user.id, draftSlot: i + 2 },
        }),
      ),
    );

    const { draft } = await startDraft(league.id, owner.id);
    const result = await getLeagueDetail(league.id, owner.id);

    expect(result?.draft).toEqual({ id: draft.id });
  });
});
