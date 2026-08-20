import { prisma } from "@fdm/database";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanupLeagueTestData, createTestUser } from "../../../../../../test/db";
import { createLeague } from "../../../../../../lib/leagues/create-league";
import { PUT } from "./route";

const authMock = vi.fn();

vi.mock("../../../../../../lib/auth", () => ({
  auth: () => authMock(),
}));

function jsonRequest(body: unknown) {
  return new Request("http://localhost/api/leagues/some-id/members/order", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

function ctxFor(leagueId: string) {
  return { params: Promise.resolve({ leagueId }) };
}

async function createTestLeague(ownerId: string, teamCount = 12) {
  return createLeague(
    {
      name: "Reorder Route Test League",
      rosterSize: 16,
      teamCount,
      timerSeconds: 60,
      scoringFormat: "PPR",
      draftType: "SNAKE",
    },
    ownerId,
  );
}

describe("PUT /api/leagues/[leagueId]/members/order", () => {
  beforeEach(async () => {
    authMock.mockReset();
    await cleanupLeagueTestData();
  });

  afterEach(async () => {
    await cleanupLeagueTestData();
  });

  it("rejects an unauthenticated request with 401 and changes nothing", async () => {
    authMock.mockResolvedValue(null);
    const owner = await createTestUser();
    const { league, membership } = await createTestLeague(owner.id);

    const response = await PUT(
      jsonRequest({ memberIds: [membership.id] }),
      ctxFor(league.id),
    );

    expect(response.status).toBe(401);
  });

  it("rejects a malformed body with 400", async () => {
    const owner = await createTestUser();
    const { league } = await createTestLeague(owner.id);
    authMock.mockResolvedValue({ user: { id: owner.id } });

    const response = await PUT(jsonRequest({ memberIds: [] }), ctxFor(league.id));

    expect(response.status).toBe(400);
  });

  it("returns 404 for a nonexistent league", async () => {
    const someone = await createTestUser();
    authMock.mockResolvedValue({ user: { id: someone.id } });

    const response = await PUT(
      jsonRequest({ memberIds: ["some-id"] }),
      ctxFor("nonexistent-id"),
    );

    expect(response.status).toBe(404);
  });

  it("returns 403 for an authenticated non-owner member", async () => {
    const owner = await createTestUser();
    const member = await createTestUser();
    const { league, membership: ownerMembership } = await createTestLeague(owner.id);
    const memberMembership = await prisma.leagueMember.create({
      data: { leagueId: league.id, userId: member.id, draftSlot: 2 },
    });
    authMock.mockResolvedValue({ user: { id: member.id } });

    const response = await PUT(
      jsonRequest({ memberIds: [memberMembership.id, ownerMembership.id] }),
      ctxFor(league.id),
    );

    expect(response.status).toBe(403);
  });

  it("returns 409 when the submitted set does not match current membership", async () => {
    const owner = await createTestUser();
    const { league } = await createTestLeague(owner.id);
    authMock.mockResolvedValue({ user: { id: owner.id } });

    const response = await PUT(
      jsonRequest({ memberIds: ["not-a-real-member-id"] }),
      ctxFor(league.id),
    );

    expect(response.status).toBe(409);
  });

  it("lets the owner reorder members and returns 200 with the DTO", async () => {
    const owner = await createTestUser({ name: "Owner" });
    const other = await createTestUser({ name: "Other" });
    const { league, membership: ownerMembership } = await createTestLeague(owner.id, 4);
    const otherMembership = await prisma.leagueMember.create({
      data: { leagueId: league.id, userId: other.id, draftSlot: 2 },
    });
    authMock.mockResolvedValue({ user: { id: owner.id } });

    const response = await PUT(
      jsonRequest({ memberIds: [otherMembership.id, ownerMembership.id] }),
      ctxFor(league.id),
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.members.map((m: { membershipId: string }) => m.membershipId)).toEqual([
      otherMembership.id,
      ownerMembership.id,
    ]);
    expect(body.members.map((m: { draftSlot: number }) => m.draftSlot)).toEqual([1, 2]);

    const persisted = await prisma.leagueMember.findUnique({
      where: { id: otherMembership.id },
    });
    expect(persisted?.draftSlot).toBe(1);
  });
});
