import { prisma } from "@fdm/database";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanupLeagueTestData, createTestUser } from "@fdm/database/test-support";
import { createLeague } from "../../../../../../lib/leagues/create-league";
import { joinLeague } from "../../../../../../lib/leagues/join-league";
import { startDraft } from "../../../../../../lib/drafts/start-draft";
import { POST } from "./route";

const authMock = vi.fn();

vi.mock("../../../../../../lib/auth", () => ({
  auth: () => authMock(),
}));

function fillRequest() {
  return new Request("http://localhost/api/leagues/some-id/bots/fill", { method: "POST" });
}

function ctxFor(leagueId: string) {
  return { params: Promise.resolve({ leagueId }) };
}

async function createTestLeague(ownerId: string, teamCount = 4) {
  return createLeague(
    {
      name: "Fill Bots Route Test League",
      rosterSize: 15,
      teamCount,
      timerSeconds: 60,
      scoringFormat: "PPR",
      draftType: "SNAKE",
    },
    ownerId,
  );
}

describe("POST /api/leagues/[leagueId]/bots/fill", () => {
  beforeEach(async () => {
    authMock.mockReset();
    await cleanupLeagueTestData();
  });

  afterEach(async () => {
    await cleanupLeagueTestData();
  });

  it("rejects an unauthenticated request with 401 and creates no bots", async () => {
    authMock.mockResolvedValue(null);
    const owner = await createTestUser();
    const { league } = await createTestLeague(owner.id);

    const response = await POST(fillRequest(), ctxFor(league.id));

    expect(response.status).toBe(401);
    const members = await prisma.leagueMember.findMany({ where: { leagueId: league.id } });
    expect(members).toHaveLength(1);
  });

  it("returns 404 for a nonexistent league", async () => {
    const someone = await createTestUser();
    authMock.mockResolvedValue({ user: { id: someone.id } });

    const response = await POST(fillRequest(), ctxFor("nonexistent-id"));

    expect(response.status).toBe(404);
  });

  it("returns 403 for an authenticated non-owner member", async () => {
    const owner = await createTestUser();
    const { league } = await createTestLeague(owner.id);
    const member = await createTestUser();
    await joinLeague(league.inviteCode, member.id);
    authMock.mockResolvedValue({ user: { id: member.id } });

    const response = await POST(fillRequest(), ctxFor(league.id));

    expect(response.status).toBe(403);
  });

  it("returns 409 once a Draft already exists", async () => {
    const owner = await createTestUser();
    const { league } = await createTestLeague(owner.id, 2);
    const joiner = await createTestUser();
    await joinLeague(league.inviteCode, joiner.id);
    await startDraft(league.id, owner.id);
    authMock.mockResolvedValue({ user: { id: owner.id } });

    const response = await POST(fillRequest(), ctxFor(league.id));

    expect(response.status).toBe(409);
  });

  it("returns 200 with the created bot count and normalized member DTO on success", async () => {
    const owner = await createTestUser();
    const { league } = await createTestLeague(owner.id, 4);
    authMock.mockResolvedValue({ user: { id: owner.id } });

    const response = await POST(fillRequest(), ctxFor(league.id));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.botsCreated).toBe(3);
    expect(body.members).toHaveLength(4);
    expect(body.members.every((m: { user?: unknown }) => m.user === undefined)).toBe(true);
  });

  it("returns 200 with botsCreated: 0 as an idempotent no-op once the league is already full", async () => {
    const owner = await createTestUser();
    const { league } = await createTestLeague(owner.id, 1);
    authMock.mockResolvedValue({ user: { id: owner.id } });

    const response = await POST(fillRequest(), ctxFor(league.id));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.botsCreated).toBe(0);
  });
});
