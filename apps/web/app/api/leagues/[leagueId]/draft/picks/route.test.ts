import { prisma } from "@fdm/database";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanupLeagueTestData, createTestPlayer, createTestUser } from "@fdm/database/test-support";
import { createLeague } from "../../../../../../lib/leagues/create-league";
import { startDraft } from "../../../../../../lib/drafts/start-draft";
import { POST } from "./route";

const authMock = vi.fn();

vi.mock("../../../../../../lib/auth", () => ({
  auth: () => authMock(),
}));

function pickRequest(body: unknown) {
  return new Request("http://localhost/api/leagues/some-id/draft/picks", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

function ctxFor(leagueId: string) {
  return { params: Promise.resolve({ leagueId }) };
}

async function createTestLeague(ownerId: string, teamCount = 4) {
  return createLeague(
    {
      name: "Pick Route Test League",
      rosterSize: 8,
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
  return users;
}

async function startFullLeague(teamCount = 4) {
  const owner = await createTestUser();
  const { league } = await createTestLeague(owner.id, teamCount);
  const others = await fillRemainingSlots(league.id, teamCount);
  const started = await startDraft(league.id, owner.id);
  return { owner, others, league, draft: started.draft };
}

describe("POST /api/leagues/[leagueId]/draft/picks", () => {
  beforeEach(async () => {
    authMock.mockReset();
    await cleanupLeagueTestData();
  });

  afterEach(async () => {
    await cleanupLeagueTestData();
  });

  it("rejects an unauthenticated request with 401 and creates no Pick", async () => {
    authMock.mockResolvedValue(null);
    const { league } = await startFullLeague();
    const player = await createTestPlayer();

    const response = await POST(pickRequest({ playerId: player.id }), ctxFor(league.id));

    expect(response.status).toBe(401);
    const count = await prisma.pick.count();
    expect(count).toBe(0);
  });

  it("rejects a malformed body (missing playerId) with 400", async () => {
    const { league, draft } = await startFullLeague();
    authMock.mockResolvedValue({ user: { id: draft.currentUserId } });

    const response = await POST(pickRequest({}), ctxFor(league.id));

    expect(response.status).toBe(400);
  });

  it("rejects a body with unknown fields (strict schema) with 400", async () => {
    const { league, draft } = await startFullLeague();
    authMock.mockResolvedValue({ user: { id: draft.currentUserId } });
    const player = await createTestPlayer();

    const response = await POST(
      pickRequest({ playerId: player.id, draftSlot: 1 }),
      ctxFor(league.id),
    );

    expect(response.status).toBe(400);
  });

  it("returns 404 for a nonexistent league", async () => {
    const someone = await createTestUser();
    authMock.mockResolvedValue({ user: { id: someone.id } });
    const player = await createTestPlayer();

    const response = await POST(pickRequest({ playerId: player.id }), ctxFor("nonexistent-id"));

    expect(response.status).toBe(404);
  });

  it("returns 404 for an authenticated non-member", async () => {
    const { league } = await startFullLeague();
    const outsider = await createTestUser();
    authMock.mockResolvedValue({ user: { id: outsider.id } });
    const player = await createTestPlayer();

    const response = await POST(pickRequest({ playerId: player.id }), ctxFor(league.id));

    expect(response.status).toBe(404);
  });

  it("returns 404 when the league has no draft yet", async () => {
    const owner = await createTestUser();
    const { league } = await createTestLeague(owner.id, 4);
    await fillRemainingSlots(league.id, 4);
    authMock.mockResolvedValue({ user: { id: owner.id } });
    const player = await createTestPlayer();

    const response = await POST(pickRequest({ playerId: player.id }), ctxFor(league.id));

    expect(response.status).toBe(404);
  });

  it("returns 409 for an authenticated member who is not the current picker", async () => {
    const { league, others } = await startFullLeague();
    authMock.mockResolvedValue({ user: { id: others[0].id } });
    const player = await createTestPlayer();

    const response = await POST(pickRequest({ playerId: player.id }), ctxFor(league.id));

    expect(response.status).toBe(409);
  });

  it("returns 404 for an unknown playerId", async () => {
    const { league, draft } = await startFullLeague();
    authMock.mockResolvedValue({ user: { id: draft.currentUserId } });

    const response = await POST(
      pickRequest({ playerId: "nonexistent-player" }),
      ctxFor(league.id),
    );

    expect(response.status).toBe(404);
  });

  it("returns 409 for an already-drafted player", async () => {
    const { league, draft } = await startFullLeague();
    authMock.mockResolvedValue({ user: { id: draft.currentUserId } });
    const player = await createTestPlayer();

    const first = await POST(pickRequest({ playerId: player.id }), ctxFor(league.id));
    expect(first.status).toBe(201);
    const firstBody = await first.json();
    const secondPicker = firstBody.draft.currentUserId;

    authMock.mockResolvedValue({ user: { id: secondPicker } });
    const response = await POST(pickRequest({ playerId: player.id }), ctxFor(league.id));

    expect(response.status).toBe(409);
  });

  it("lets the current picker submit a pick and returns 201 with the DTO", async () => {
    const { league, draft } = await startFullLeague();
    authMock.mockResolvedValue({ user: { id: draft.currentUserId } });
    const player = await createTestPlayer();

    const response = await POST(pickRequest({ playerId: player.id }), ctxFor(league.id));
    const body = await response.json();

    expect(response.status).toBe(201);
    expect(body.pick.playerId).toBe(player.id);
    expect(body.pick.pickNumber).toBe(1);
    expect(body.pick.wasAutopick).toBe(false);
    expect(body.draft.currentPickNumber).toBe(2);

    const persisted = await prisma.pick.findUnique({
      where: { draftId_playerId: { draftId: draft.id, playerId: player.id } },
    });
    expect(persisted).not.toBeNull();
  });
});
