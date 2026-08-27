import {
  DraftAlreadyStartedError,
  LeagueNotAccessibleError,
  NotLeagueOwnerError,
  ReorderMembershipMismatchError,
  prisma,
} from "@fdm/database";
import { cleanupLeagueTestData, createTestUser } from "@fdm/database/test-support";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { startDraft } from "../drafts/start-draft";
import { createLeague } from "./create-league";
import { reorderLeagueMembers } from "./reorder-league-members";

async function createTestLeague(ownerId: string, teamCount = 12) {
  return createLeague(
    {
      name: "Reorder Test League",
      rosterSize: 16,
      teamCount,
      timerSeconds: 60,
      scoringFormat: "PPR",
      draftType: "SNAKE",
    },
    ownerId,
  );
}

async function currentSlots(leagueId: string) {
  const members = await prisma.leagueMember.findMany({
    where: { leagueId },
    orderBy: { draftSlot: "asc" },
    select: { id: true, draftSlot: true },
  });
  return members;
}

describe("reorderLeagueMembers", () => {
  beforeEach(async () => {
    await cleanupLeagueTestData();
  });

  afterEach(async () => {
    await cleanupLeagueTestData();
  });

  it("swaps two members without violating the unique (leagueId, draftSlot) constraint", async () => {
    const owner = await createTestUser({ name: "Owner" });
    const other = await createTestUser({ name: "Other" });
    const { league, membership: ownerMembership } = await createTestLeague(owner.id, 4);
    const otherMembership = await prisma.leagueMember.create({
      data: { leagueId: league.id, userId: other.id, draftSlot: 2 },
    });
    // owner at slot 1, other at slot 2 - request the exact swap that fails
    // under a naive sequential update.
    const result = await reorderLeagueMembers(
      league.id,
      { memberIds: [otherMembership.id, ownerMembership.id] },
      owner.id,
    );

    expect(result.members.map((m) => m.membershipId)).toEqual([
      otherMembership.id,
      ownerMembership.id,
    ]);
    expect(result.members.map((m) => m.draftSlot)).toEqual([1, 2]);
  });

  it("fully reverses N members and lands on exactly 1..N with no duplicates", async () => {
    const owner = await createTestUser();
    const { league, membership: ownerMembership } = await createTestLeague(owner.id, 5);
    const joiners = await Promise.all(
      Array.from({ length: 4 }, () => createTestUser()),
    );
    const memberships = [ownerMembership];
    for (let i = 0; i < joiners.length; i++) {
      const m = await prisma.leagueMember.create({
        data: { leagueId: league.id, userId: joiners[i]!.id, draftSlot: i + 2 },
      });
      memberships.push(m);
    }

    const reversedIds = [...memberships].reverse().map((m) => m.id);
    const result = await reorderLeagueMembers(league.id, { memberIds: reversedIds }, owner.id);

    expect(result.members.map((m) => m.membershipId)).toEqual(reversedIds);
    expect(result.members.map((m) => m.draftSlot)).toEqual([1, 2, 3, 4, 5]);

    const slots = (await currentSlots(league.id)).map((m) => m.draftSlot).sort((a, b) => a - b);
    expect(slots).toEqual([1, 2, 3, 4, 5]);
    expect(new Set(slots).size).toBe(5);
  });

  it("rejects a submission missing a current member and leaves order unchanged", async () => {
    const owner = await createTestUser();
    const other = await createTestUser();
    const { league, membership: ownerMembership } = await createTestLeague(owner.id, 4);
    await prisma.leagueMember.create({
      data: { leagueId: league.id, userId: other.id, draftSlot: 2 },
    });

    const before = await currentSlots(league.id);

    await expect(
      reorderLeagueMembers(league.id, { memberIds: [ownerMembership.id] }, owner.id),
    ).rejects.toBeInstanceOf(ReorderMembershipMismatchError);

    const after = await currentSlots(league.id);
    expect(after).toEqual(before);
  });

  it("rejects a submission containing a foreign-league membership id and leaves order unchanged", async () => {
    const owner = await createTestUser();
    const other = await createTestUser();
    const { league, membership: ownerMembership } = await createTestLeague(owner.id, 4);
    await prisma.leagueMember.create({
      data: { leagueId: league.id, userId: other.id, draftSlot: 2 },
    });

    const foreignOwner = await createTestUser();
    const { membership: foreignMembership } = await createTestLeague(foreignOwner.id, 4);

    const before = await currentSlots(league.id);

    await expect(
      reorderLeagueMembers(
        league.id,
        { memberIds: [ownerMembership.id, foreignMembership.id] },
        owner.id,
      ),
    ).rejects.toBeInstanceOf(ReorderMembershipMismatchError);

    const after = await currentSlots(league.id);
    expect(after).toEqual(before);
  });

  it("rejects a non-owner member and leaves order unchanged", async () => {
    const owner = await createTestUser();
    const member = await createTestUser();
    const { league, membership: ownerMembership } = await createTestLeague(owner.id, 4);
    const memberMembership = await prisma.leagueMember.create({
      data: { leagueId: league.id, userId: member.id, draftSlot: 2 },
    });

    const before = await currentSlots(league.id);

    await expect(
      reorderLeagueMembers(
        league.id,
        { memberIds: [memberMembership.id, ownerMembership.id] },
        member.id,
      ),
    ).rejects.toBeInstanceOf(NotLeagueOwnerError);

    const after = await currentSlots(league.id);
    expect(after).toEqual(before);
  });

  it("rejects an authenticated non-member with LeagueNotAccessibleError", async () => {
    const owner = await createTestUser();
    const outsider = await createTestUser();
    const { league, membership: ownerMembership } = await createTestLeague(owner.id, 4);

    await expect(
      reorderLeagueMembers(league.id, { memberIds: [ownerMembership.id] }, outsider.id),
    ).rejects.toBeInstanceOf(LeagueNotAccessibleError);
  });

  it("rejects reordering once a Draft exists and leaves order unchanged", async () => {
    const owner = await createTestUser();
    const other = await createTestUser();
    const { league, membership: ownerMembership } = await createTestLeague(owner.id, 4);
    const otherMembership = await prisma.leagueMember.create({
      data: { leagueId: league.id, userId: other.id, draftSlot: 2 },
    });
    const rest = await Promise.all([createTestUser(), createTestUser()]);
    await prisma.leagueMember.create({
      data: { leagueId: league.id, userId: rest[0]!.id, draftSlot: 3 },
    });
    await prisma.leagueMember.create({
      data: { leagueId: league.id, userId: rest[1]!.id, draftSlot: 4 },
    });
    await startDraft(league.id, owner.id);

    const before = await currentSlots(league.id);

    await expect(
      reorderLeagueMembers(
        league.id,
        { memberIds: [otherMembership.id, ownerMembership.id] },
        owner.id,
      ),
    ).rejects.toBeInstanceOf(DraftAlreadyStartedError);

    const after = await currentSlots(league.id);
    expect(after).toEqual(before);
  });
});
