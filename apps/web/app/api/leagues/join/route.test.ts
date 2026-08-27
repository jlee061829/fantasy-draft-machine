import { prisma } from "@fdm/database";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanupLeagueTestData, createTestUser } from "@fdm/database/test-support";
import { createLeague } from "../../../../lib/leagues/create-league";
import { POST } from "./route";

const authMock = vi.fn();

vi.mock("../../../../lib/auth", () => ({
  auth: () => authMock(),
}));

function jsonRequest(body: unknown) {
  return new Request("http://localhost/api/leagues/join", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

async function createTestLeague(ownerId: string, teamCount = 12) {
  return createLeague(
    {
      name: "Join Route Test League",
      rosterSize: 16,
      teamCount,
      timerSeconds: 60,
      scoringFormat: "PPR",
      draftType: "SNAKE",
    },
    ownerId,
  );
}

describe("POST /api/leagues/join", () => {
  beforeEach(async () => {
    authMock.mockReset();
    await cleanupLeagueTestData();
  });

  afterEach(async () => {
    await cleanupLeagueTestData();
  });

  it("rejects an unauthenticated request with 401 and creates no membership", async () => {
    authMock.mockResolvedValue(null);
    const owner = await createTestUser();
    const { league } = await createTestLeague(owner.id);

    const response = await POST(jsonRequest({ inviteCode: league.inviteCode }));

    expect(response.status).toBe(401);
    expect(await prisma.leagueMember.count({ where: { leagueId: league.id } })).toBe(1);
  });

  it("rejects a malformed invite code with 400", async () => {
    const user = await createTestUser();
    authMock.mockResolvedValue({ user: { id: user.id } });

    const response = await POST(jsonRequest({ inviteCode: "short" }));

    expect(response.status).toBe(400);
  });

  it("rejects an otherwise-valid request containing an unexpected field with 400", async () => {
    const owner = await createTestUser();
    const { league } = await createTestLeague(owner.id);
    const joiner = await createTestUser();
    authMock.mockResolvedValue({ user: { id: joiner.id } });

    const response = await POST(
      jsonRequest({ inviteCode: league.inviteCode, userId: "spoofed" }),
    );

    expect(response.status).toBe(400);
    expect(await prisma.leagueMember.count({ where: { leagueId: league.id } })).toBe(1);
  });

  it("returns 404 for an unknown invite code", async () => {
    const user = await createTestUser();
    authMock.mockResolvedValue({ user: { id: user.id } });

    const response = await POST(jsonRequest({ inviteCode: "ZZZZZZZZ" }));

    expect(response.status).toBe(404);
  });

  it("joins the authenticated user and returns 201 with the DTO", async () => {
    const owner = await createTestUser();
    const { league } = await createTestLeague(owner.id);
    const joiner = await createTestUser();
    authMock.mockResolvedValue({ user: { id: joiner.id } });

    const response = await POST(jsonRequest({ inviteCode: league.inviteCode }));
    const body = await response.json();

    expect(response.status).toBe(201);
    expect(body.league.id).toBe(league.id);
    expect(body.membership.draftSlot).toBe(2);

    const membership = await prisma.leagueMember.findUnique({
      where: { leagueId_userId: { leagueId: league.id, userId: joiner.id } },
    });
    expect(membership?.draftSlot).toBe(2);
  });

  it("returns 409 when the user is already a member", async () => {
    const owner = await createTestUser();
    const { league } = await createTestLeague(owner.id);
    authMock.mockResolvedValue({ user: { id: owner.id } });

    const response = await POST(jsonRequest({ inviteCode: league.inviteCode }));

    expect(response.status).toBe(409);
  });

  it("returns 409 when the league is at capacity", async () => {
    const owner = await createTestUser();
    const { league } = await createTestLeague(owner.id, 4);
    for (let i = 0; i < 3; i++) {
      const joiner = await createTestUser();
      authMock.mockResolvedValue({ user: { id: joiner.id } });
      await POST(jsonRequest({ inviteCode: league.inviteCode }));
    }

    const overflowJoiner = await createTestUser();
    authMock.mockResolvedValue({ user: { id: overflowJoiner.id } });
    const response = await POST(jsonRequest({ inviteCode: league.inviteCode }));

    expect(response.status).toBe(409);
  });
});
