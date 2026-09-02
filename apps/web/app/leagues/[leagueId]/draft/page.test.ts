import { cleanupLeagueTestData, createTestUser } from "@fdm/database/test-support";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createLeague } from "../../../../lib/leagues/create-league";
import DraftRoomPage from "./page";

const authMock = vi.fn();

vi.mock("../../../../lib/auth", () => ({
  auth: () => authMock(),
  signIn: vi.fn(),
}));

class NotFoundSentinel extends Error {}
const notFoundMock = vi.fn(() => {
  throw new NotFoundSentinel();
});

vi.mock("next/navigation", () => ({
  notFound: () => notFoundMock(),
}));

function paramsFor(leagueId: string) {
  return Promise.resolve({ leagueId });
}

function testLeague(ownerId: string) {
  return createLeague(
    {
      name: "Draft Harness Test League",
      rosterSize: 16,
      teamCount: 12,
      timerSeconds: 60,
      scoringFormat: "PPR",
      draftType: "SNAKE",
    },
    ownerId,
  );
}

describe("DraftRoomPage", () => {
  beforeEach(async () => {
    authMock.mockReset();
    notFoundMock.mockClear();
    await cleanupLeagueTestData();
  });

  afterEach(async () => {
    await cleanupLeagueTestData();
  });

  it("renders the sign-in branch without calling notFound() when unauthenticated", async () => {
    authMock.mockResolvedValue(null);

    await DraftRoomPage({ params: paramsFor("does-not-matter") });

    expect(notFoundMock).not.toHaveBeenCalled();
  });

  it("calls notFound() for a nonexistent league", async () => {
    const user = await createTestUser();
    authMock.mockResolvedValue({ user: { id: user.id } });

    await expect(DraftRoomPage({ params: paramsFor("nonexistent-id") })).rejects.toBeInstanceOf(
      NotFoundSentinel,
    );
    expect(notFoundMock).toHaveBeenCalledTimes(1);
  });

  it("calls notFound() for an authenticated non-member", async () => {
    const owner = await createTestUser();
    const outsider = await createTestUser();
    authMock.mockResolvedValue({ user: { id: outsider.id } });
    const { league } = await testLeague(owner.id);

    await expect(DraftRoomPage({ params: paramsFor(league.id) })).rejects.toBeInstanceOf(
      NotFoundSentinel,
    );
    expect(notFoundMock).toHaveBeenCalledTimes(1);
  });

  it("does not call notFound() for an authorized member", async () => {
    const owner = await createTestUser();
    authMock.mockResolvedValue({ user: { id: owner.id } });
    const { league } = await testLeague(owner.id);

    await DraftRoomPage({ params: paramsFor(league.id) });

    expect(notFoundMock).not.toHaveBeenCalled();
  });

  it("threads the authenticated session's userId into DraftRoomClient as currentUserId", async () => {
    const owner = await createTestUser();
    authMock.mockResolvedValue({ user: { id: owner.id } });
    const { league } = await testLeague(owner.id);

    const element = await DraftRoomPage({ params: paramsFor(league.id) });

    // DraftRoomPage renders <DraftRoomClient ... /> directly (no wrapping
    // fragment), so its returned element's own props carry currentUserId —
    // no rendering/DOM needed to verify it made it through.
    expect((element as unknown as { props: { currentUserId: string } }).props.currentUserId).toBe(
      owner.id,
    );
  });
});
