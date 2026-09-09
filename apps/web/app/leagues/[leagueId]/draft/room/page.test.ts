import { prisma } from "@fdm/database";
import { cleanupLeagueTestData, createTestPlayer, createTestUser } from "@fdm/database/test-support";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createLeague } from "../../../../../lib/leagues/create-league";
import { startDraft } from "../../../../../lib/drafts/start-draft";
import LiveDraftRoomPage from "./page";

const authMock = vi.fn();

vi.mock("../../../../../lib/auth", () => ({
  auth: () => authMock(),
  signIn: vi.fn(),
}));

class NotFoundSentinel extends Error {}
const notFoundMock = vi.fn(() => {
  throw new NotFoundSentinel();
});

class RedirectSentinel extends Error {
  constructor(public target: string) {
    super(`redirect:${target}`);
  }
}
const redirectMock = vi.fn((target: string) => {
  throw new RedirectSentinel(target);
});

vi.mock("next/navigation", () => ({
  notFound: () => notFoundMock(),
  redirect: (target: string) => redirectMock(target),
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

describe("LiveDraftRoomPage", () => {
  beforeEach(async () => {
    authMock.mockReset();
    notFoundMock.mockClear();
    redirectMock.mockClear();
    await cleanupLeagueTestData();
  });

  afterEach(async () => {
    await cleanupLeagueTestData();
  });

  it("renders the sign-in branch without calling notFound() when unauthenticated", async () => {
    authMock.mockResolvedValue(null);

    await LiveDraftRoomPage({ params: paramsFor("does-not-matter") });

    expect(notFoundMock).not.toHaveBeenCalled();
    expect(redirectMock).not.toHaveBeenCalled();
  });

  it("calls notFound() for a nonexistent league", async () => {
    const user = await createTestUser();
    authMock.mockResolvedValue({ user: { id: user.id } });

    await expect(
      LiveDraftRoomPage({ params: paramsFor("nonexistent-id") }),
    ).rejects.toBeInstanceOf(NotFoundSentinel);
    expect(notFoundMock).toHaveBeenCalledTimes(1);
  });

  it("calls notFound() for an authenticated non-member", async () => {
    const owner = await createTestUser();
    const outsider = await createTestUser();
    authMock.mockResolvedValue({ user: { id: outsider.id } });
    const { league } = await testLeague(owner.id);

    await expect(
      LiveDraftRoomPage({ params: paramsFor(league.id) }),
    ).rejects.toBeInstanceOf(NotFoundSentinel);
    expect(notFoundMock).toHaveBeenCalledTimes(1);
  });

  // Milestone 4.5: the live room is no longer where "no Draft yet" is
  // rendered — a member reaching this route before the commissioner has
  // started the draft (a stale link, or direct navigation) is redirected
  // back to the pre-draft page instead.
  it("redirects to the pre-draft page when no Draft exists yet", async () => {
    const owner = await createTestUser();
    authMock.mockResolvedValue({ user: { id: owner.id } });
    const { league } = await testLeague(owner.id);

    await expect(
      LiveDraftRoomPage({ params: paramsFor(league.id) }),
    ).rejects.toBeInstanceOf(RedirectSentinel);
    expect(redirectMock).toHaveBeenCalledWith(`/leagues/${league.id}/draft`);
    expect(notFoundMock).not.toHaveBeenCalled();
  });

  it("does not call notFound() or redirect() for an authorized member once a Draft exists", async () => {
    const owner = await createTestUser();
    authMock.mockResolvedValue({ user: { id: owner.id } });
    const { league } = await testLeague(owner.id);
    await fillRemainingSlots(league.id, 12);
    await startDraft(league.id, owner.id);

    await LiveDraftRoomPage({ params: paramsFor(league.id) });

    expect(notFoundMock).not.toHaveBeenCalled();
    expect(redirectMock).not.toHaveBeenCalled();
  });

  it("threads the authenticated session's userId into DraftRoomClient as currentUserId", async () => {
    const owner = await createTestUser();
    authMock.mockResolvedValue({ user: { id: owner.id } });
    const { league } = await testLeague(owner.id);
    await fillRemainingSlots(league.id, 12);
    await startDraft(league.id, owner.id);

    const element = await LiveDraftRoomPage({ params: paramsFor(league.id) });

    // LiveDraftRoomPage renders <DraftRoomClient ... /> directly (no
    // wrapping fragment), so its returned element's own props carry
    // currentUserId — no rendering/DOM needed to verify it made it through.
    expect((element as unknown as { props: { currentUserId: string } }).props.currentUserId).toBe(
      owner.id,
    );
  });

  it("threads a rostered player pool matching the league's scoring format into DraftRoomClient", async () => {
    const owner = await createTestUser();
    authMock.mockResolvedValue({ user: { id: owner.id } });
    const { league } = await testLeague(owner.id); // PPR, per testLeague()
    await fillRemainingSlots(league.id, 12);
    await startDraft(league.id, owner.id);

    const rostered = await createTestPlayer({ fullName: "Rostered", nflTeam: "CIN" });
    await prisma.playerAdp.create({
      data: { playerId: rostered.id, format: "PPR", adp: 3.2, source: "test" },
    });
    const freeAgent = await createTestPlayer({ fullName: "Free Agent", nflTeam: null });
    await prisma.playerAdp.create({
      data: { playerId: freeAgent.id, format: "PPR", adp: 1, source: "test" },
    });

    const element = await LiveDraftRoomPage({ params: paramsFor(league.id) });

    const players = (
      element as unknown as {
        props: { players: Array<{ id: string; adp: number | null }> };
      }
    ).props.players;

    expect(players.find((p) => p.id === rostered.id)?.adp).toBe(3.2);
    expect(players.find((p) => p.id === freeAgent.id)).toBeUndefined();
  });
});
