import { prisma } from "@fdm/database";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanupLeagueTestData, createTestUser } from "../../../../../test/db";
import { createLeague } from "../../../../../lib/leagues/create-league";
import { POST } from "./route";

const authMock = vi.fn();

vi.mock("../../../../../lib/auth", () => ({
  auth: () => authMock(),
}));

function draftRequest() {
  return new Request("http://localhost/api/leagues/some-id/draft", { method: "POST" });
}

function ctxFor(leagueId: string) {
  return { params: Promise.resolve({ leagueId }) };
}

async function createTestLeague(ownerId: string, teamCount = 4) {
  return createLeague(
    {
      name: "Draft Start Route Test League",
      rosterSize: 16,
      teamCount,
      timerSeconds: 60,
      scoringFormat: "PPR",
      draftType: "SNAKE",
    },
    ownerId,
  );
}

async function fillRemainingSlots(leagueId: string, teamCount: number) {
  const users = await Promise.all(Array.from({ length: teamCount - 1 }, () => createTestUser()));
  await Promise.all(
    users.map((user, i) =>
      prisma.leagueMember.create({
        data: { leagueId, userId: user.id, draftSlot: i + 2 },
      }),
    ),
  );
}

describe("POST /api/leagues/[leagueId]/draft", () => {
  beforeEach(async () => {
    authMock.mockReset();
    await cleanupLeagueTestData();
  });

  afterEach(async () => {
    await cleanupLeagueTestData();
  });

  it("rejects an unauthenticated request with 401 and creates no Draft", async () => {
    authMock.mockResolvedValue(null);
    const owner = await createTestUser();
    const { league } = await createTestLeague(owner.id);

    const response = await POST(draftRequest(), ctxFor(league.id));

    expect(response.status).toBe(401);
    const draft = await prisma.draft.findUnique({ where: { leagueId: league.id } });
    expect(draft).toBeNull();
  });

  it("returns 404 for a nonexistent league", async () => {
    const someone = await createTestUser();
    authMock.mockResolvedValue({ user: { id: someone.id } });

    const response = await POST(draftRequest(), ctxFor("nonexistent-id"));

    expect(response.status).toBe(404);
  });

  it("returns 403 for an authenticated non-owner member", async () => {
    const owner = await createTestUser();
    const member = await createTestUser();
    const { league } = await createTestLeague(owner.id);
    await prisma.leagueMember.create({
      data: { leagueId: league.id, userId: member.id, draftSlot: 2 },
    });
    authMock.mockResolvedValue({ user: { id: member.id } });

    const response = await POST(draftRequest(), ctxFor(league.id));

    expect(response.status).toBe(403);
  });

  it("returns 409 when the league is not completely filled", async () => {
    const owner = await createTestUser();
    const { league } = await createTestLeague(owner.id, 4);
    authMock.mockResolvedValue({ user: { id: owner.id } });

    const response = await POST(draftRequest(), ctxFor(league.id));

    expect(response.status).toBe(409);
    const draft = await prisma.draft.findUnique({ where: { leagueId: league.id } });
    expect(draft).toBeNull();
  });

  it("lets the owner start a full league and returns 201 with the DTO", async () => {
    const owner = await createTestUser();
    const { league } = await createTestLeague(owner.id, 4);
    await fillRemainingSlots(league.id, 4);
    authMock.mockResolvedValue({ user: { id: owner.id } });

    const response = await POST(draftRequest(), ctxFor(league.id));
    const body = await response.json();

    expect(response.status).toBe(201);
    expect(body.draft.status).toBe("ACTIVE");
    expect(body.draft.currentUserId).toBe(owner.id);
    expect(body.draft.currentPickNumber).toBe(1);

    const persisted = await prisma.draft.findUnique({ where: { leagueId: league.id } });
    expect(persisted?.status).toBe("ACTIVE");
  });

  it("returns 409 for a second start attempt", async () => {
    const owner = await createTestUser();
    const { league } = await createTestLeague(owner.id, 4);
    await fillRemainingSlots(league.id, 4);
    authMock.mockResolvedValue({ user: { id: owner.id } });

    await POST(draftRequest(), ctxFor(league.id));
    const response = await POST(draftRequest(), ctxFor(league.id));

    expect(response.status).toBe(409);
    const drafts = await prisma.draft.findMany({ where: { leagueId: league.id } });
    expect(drafts).toHaveLength(1);
  });
});
