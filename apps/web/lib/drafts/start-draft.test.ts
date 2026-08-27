import {
  DraftAlreadyExistsError,
  LeagueNotAccessibleError,
  LeagueNotFullError,
  NotLeagueOwnerError,
  prisma,
} from "@fdm/database";
import { cleanupLeagueTestData, createTestUser } from "@fdm/database/test-support";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createLeague } from "../leagues/create-league";
import { startDraft } from "./start-draft";

async function createTestLeague(
  ownerId: string,
  overrides: Partial<{ teamCount: number; draftType: "SNAKE" | "LINEAR"; timerSeconds: number }> = {},
) {
  return createLeague(
    {
      name: "Draft Start Test League",
      rosterSize: 16,
      teamCount: overrides.teamCount ?? 4,
      timerSeconds: overrides.timerSeconds ?? 60,
      scoringFormat: "PPR",
      draftType: overrides.draftType ?? "SNAKE",
    },
    ownerId,
  );
}

// Owner already occupies slot 1 from league creation; this fills the
// remaining slots 2..teamCount with fresh members.
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

describe("startDraft", () => {
  beforeEach(async () => {
    await cleanupLeagueTestData();
  });

  afterEach(async () => {
    await cleanupLeagueTestData();
  });

  it("rejects a nonexistent league", async () => {
    const someone = await createTestUser();

    await expect(startDraft("nonexistent-id", someone.id)).rejects.toBeInstanceOf(
      LeagueNotAccessibleError,
    );
  });

  it("rejects an authenticated non-member", async () => {
    const owner = await createTestUser();
    const { league } = await createTestLeague(owner.id);
    const outsider = await createTestUser();

    await expect(startDraft(league.id, outsider.id)).rejects.toBeInstanceOf(
      LeagueNotAccessibleError,
    );
  });

  it("rejects an authenticated non-owner member", async () => {
    const owner = await createTestUser();
    const { league } = await createTestLeague(owner.id, { teamCount: 4 });
    const member = await createTestUser();
    await prisma.leagueMember.create({
      data: { leagueId: league.id, userId: member.id, draftSlot: 2 },
    });

    await expect(startDraft(league.id, member.id)).rejects.toBeInstanceOf(NotLeagueOwnerError);
  });

  it("rejects starting an underfilled league and creates no Draft", async () => {
    const owner = await createTestUser();
    const { league } = await createTestLeague(owner.id, { teamCount: 4 });
    // only the owner (slot 1) is a member; the league needs 4

    await expect(startDraft(league.id, owner.id)).rejects.toBeInstanceOf(LeagueNotFullError);

    const draft = await prisma.draft.findUnique({ where: { leagueId: league.id } });
    expect(draft).toBeNull();
  });

  it("starts a full SNAKE league with the correct first picker and deadline", async () => {
    const owner = await createTestUser();
    const before = Date.now();
    const { league } = await createTestLeague(owner.id, {
      teamCount: 4,
      draftType: "SNAKE",
      timerSeconds: 90,
    });
    await fillRemainingSlots(league.id, 4);

    const result = await startDraft(league.id, owner.id);

    expect(result.draft.status).toBe("ACTIVE");
    expect(result.draft.currentPickNumber).toBe(1);
    // slot 1 is the first picker for pick 1 regardless of draft type, and
    // the owner holds slot 1 from league creation.
    expect(result.draft.currentUserId).toBe(owner.id);

    const deadline = new Date(result.draft.turnDeadline).getTime();
    expect(deadline).toBeGreaterThanOrEqual(before + 90_000);
    expect(deadline).toBeLessThan(before + 90_000 + 5_000);

    const persisted = await prisma.draft.findUnique({ where: { leagueId: league.id } });
    expect(persisted?.status).toBe("ACTIVE");
    expect(persisted?.currentUserId).toBe(owner.id);
    expect(persisted?.currentPickNumber).toBe(1);
  });

  it("starts a full LINEAR league with the correct first picker", async () => {
    const owner = await createTestUser();
    const { league } = await createTestLeague(owner.id, {
      teamCount: 4,
      draftType: "LINEAR",
    });
    await fillRemainingSlots(league.id, 4);

    const result = await startDraft(league.id, owner.id);

    expect(result.draft.currentUserId).toBe(owner.id);
  });

  it("rejects starting a league that already has a draft", async () => {
    const owner = await createTestUser();
    const { league } = await createTestLeague(owner.id, { teamCount: 4 });
    await fillRemainingSlots(league.id, 4);
    await startDraft(league.id, owner.id);

    await expect(startDraft(league.id, owner.id)).rejects.toBeInstanceOf(DraftAlreadyExistsError);

    const drafts = await prisma.draft.findMany({ where: { leagueId: league.id } });
    expect(drafts).toHaveLength(1);
  });

  it("under two simultaneous start attempts, exactly one Draft is created", async () => {
    const owner = await createTestUser();
    const { league } = await createTestLeague(owner.id, { teamCount: 4 });
    await fillRemainingSlots(league.id, 4);

    const outcomes = await Promise.allSettled([
      startDraft(league.id, owner.id),
      startDraft(league.id, owner.id),
    ]);

    const fulfilled = outcomes.filter((o) => o.status === "fulfilled");
    const rejected = outcomes.filter((o) => o.status === "rejected");
    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    expect((rejected[0] as PromiseRejectedResult).reason).toBeInstanceOf(DraftAlreadyExistsError);

    const drafts = await prisma.draft.findMany({ where: { leagueId: league.id } });
    expect(drafts).toHaveLength(1);
  });
});
