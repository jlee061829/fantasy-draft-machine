import { prisma } from "@fdm/database";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanupLeagueTestData, createTestUser } from "../../../../test/db";
import { createLeague } from "../../../../lib/leagues/create-league";
import { PATCH } from "./route";

const authMock = vi.fn();

vi.mock("../../../../lib/auth", () => ({
  auth: () => authMock(),
}));

function jsonRequest(body: unknown) {
  return new Request("http://localhost/api/leagues/some-id", {
    method: "PATCH",
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
      name: "Settings Route Test League",
      rosterSize: 16,
      teamCount,
      timerSeconds: 60,
      scoringFormat: "PPR",
      draftType: "SNAKE",
    },
    ownerId,
  );
}

describe("PATCH /api/leagues/[leagueId]", () => {
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
    const { league } = await createTestLeague(owner.id);

    const response = await PATCH(jsonRequest({ name: "Hijacked" }), ctxFor(league.id));

    expect(response.status).toBe(401);
    const unchanged = await prisma.league.findUnique({ where: { id: league.id } });
    expect(unchanged?.name).toBe("Settings Route Test League");
  });

  it("rejects an empty body with 400", async () => {
    const owner = await createTestUser();
    const { league } = await createTestLeague(owner.id);
    authMock.mockResolvedValue({ user: { id: owner.id } });

    const response = await PATCH(jsonRequest({}), ctxFor(league.id));

    expect(response.status).toBe(400);
  });

  it("rejects an unexpected field with 400", async () => {
    const owner = await createTestUser();
    const { league } = await createTestLeague(owner.id);
    authMock.mockResolvedValue({ user: { id: owner.id } });

    const response = await PATCH(
      jsonRequest({ name: "New Name", ownerId: "spoofed" }),
      ctxFor(league.id),
    );

    expect(response.status).toBe(400);
  });

  it("returns 404 for a nonexistent league", async () => {
    const someone = await createTestUser();
    authMock.mockResolvedValue({ user: { id: someone.id } });

    const response = await PATCH(jsonRequest({ name: "Hijacked" }), ctxFor("nonexistent-id"));

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

    const response = await PATCH(jsonRequest({ name: "Hijacked" }), ctxFor(league.id));

    expect(response.status).toBe(403);
    const unchanged = await prisma.league.findUnique({ where: { id: league.id } });
    expect(unchanged?.name).toBe("Settings Route Test League");
  });

  it("returns 409 when lowering teamCount below current membership", async () => {
    const owner = await createTestUser();
    const { league } = await createTestLeague(owner.id, 12);
    const others = await Promise.all([createTestUser(), createTestUser(), createTestUser(), createTestUser()]);
    for (let i = 0; i < others.length; i++) {
      await prisma.leagueMember.create({
        data: { leagueId: league.id, userId: others[i]!.id, draftSlot: i + 2 },
      });
    }
    // 5 members total now; requesting teamCount=4 is within the 4-20 schema
    // bound but below the current member count, so it must fail at the
    // service layer (409), not the schema layer (400).
    authMock.mockResolvedValue({ user: { id: owner.id } });

    const response = await PATCH(jsonRequest({ teamCount: 4 }), ctxFor(league.id));

    expect(response.status).toBe(409);
  });

  it("lets the owner update settings and returns 200 with the DTO", async () => {
    const owner = await createTestUser();
    const { league } = await createTestLeague(owner.id);
    authMock.mockResolvedValue({ user: { id: owner.id } });

    const response = await PATCH(
      jsonRequest({ name: "Renamed League", timerSeconds: 45 }),
      ctxFor(league.id),
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.league.name).toBe("Renamed League");
    expect(body.league.timerSeconds).toBe(45);

    const persisted = await prisma.league.findUnique({ where: { id: league.id } });
    expect(persisted?.name).toBe("Renamed League");
    expect(persisted?.timerSeconds).toBe(45);
  });
});
