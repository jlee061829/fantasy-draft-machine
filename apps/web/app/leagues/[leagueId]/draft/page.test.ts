import { prisma, submitPick } from "@fdm/database";
import Link from "next/link";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanupLeagueTestData, createTestPlayer, createTestUser } from "@fdm/database/test-support";
import { createLeague } from "../../../../lib/leagues/create-league";
import { startDraft } from "../../../../lib/drafts/start-draft";
import DraftPage from "./page";
import { StartDraftForm } from "./start-draft-form";
import { DraftBoard } from "./DraftBoard";
import { AvailablePlayersPanel } from "./AvailablePlayersPanel";

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

function testLeague(ownerId: string, teamCount = 4) {
  return createLeague(
    {
      name: "Pre-Draft Test League",
      rosterSize: 15,
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

// Same plain-element-tree inspection convention used throughout this
// project's other page tests (no @testing-library/react, no jsdom render).
function findElementsByType(node: unknown, type: unknown, acc: any[] = []): any[] {
  if (node === null || typeof node !== "object") {
    return acc;
  }
  if (Array.isArray(node)) {
    for (const child of node) findElementsByType(child, type, acc);
    return acc;
  }
  if ("type" in node && "props" in node) {
    const element = node as { type: unknown; props: { children?: unknown } };
    if (element.type === type) {
      acc.push(element);
    }
    findElementsByType(element.props.children, type, acc);
  }
  return acc;
}

describe("DraftPage (pre-draft)", () => {
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

    await DraftPage({ params: paramsFor("does-not-matter") });

    expect(notFoundMock).not.toHaveBeenCalled();
  });

  it("calls notFound() for a nonexistent league", async () => {
    const user = await createTestUser();
    authMock.mockResolvedValue({ user: { id: user.id } });

    await expect(DraftPage({ params: paramsFor("nonexistent-id") })).rejects.toBeInstanceOf(
      NotFoundSentinel,
    );
    expect(notFoundMock).toHaveBeenCalledTimes(1);
  });

  it("calls notFound() for an authenticated non-member", async () => {
    const owner = await createTestUser();
    const outsider = await createTestUser();
    authMock.mockResolvedValue({ user: { id: outsider.id } });
    const { league } = await testLeague(owner.id);

    await expect(DraftPage({ params: paramsFor(league.id) })).rejects.toBeInstanceOf(
      NotFoundSentinel,
    );
    expect(notFoundMock).toHaveBeenCalledTimes(1);
  });

  it("renders the pre-draft board and read-only Available Players when no Draft exists", async () => {
    const owner = await createTestUser();
    authMock.mockResolvedValue({ user: { id: owner.id } });
    const { league } = await testLeague(owner.id);

    const page = await DraftPage({ params: paramsFor(league.id) });

    expect(findElementsByType(page, DraftBoard)).toHaveLength(1);
    const panels = findElementsByType(page, AvailablePlayersPanel);
    expect(panels).toHaveLength(1);
    // Read-only mode: no onDraft/canDraft/pendingPlayerId supplied.
    expect(panels[0]!.props.onDraft).toBeUndefined();
  });

  it("passes currentUserId into DraftBoard for column highlighting", async () => {
    const owner = await createTestUser();
    authMock.mockResolvedValue({ user: { id: owner.id } });
    const { league } = await testLeague(owner.id);

    const page = await DraftPage({ params: paramsFor(league.id) });

    const boards = findElementsByType(page, DraftBoard);
    expect(boards).toHaveLength(1);
    expect(boards[0]!.props.currentUserId).toBe(owner.id);
  });

  it("renders a disabled Start Draft control for the commissioner when the league is not full", async () => {
    const owner = await createTestUser();
    authMock.mockResolvedValue({ user: { id: owner.id } });
    const { league } = await testLeague(owner.id, 4);

    const page = await DraftPage({ params: paramsFor(league.id) });

    const starters = findElementsByType(page, StartDraftForm);
    expect(starters).toHaveLength(1);
    expect(starters[0].props.isFull).toBe(false);
  });

  it("renders an enabled Start Draft control for the commissioner when the league is full", async () => {
    const owner = await createTestUser();
    authMock.mockResolvedValue({ user: { id: owner.id } });
    const { league } = await testLeague(owner.id, 4);
    await fillRemainingSlots(league.id, 4);

    const page = await DraftPage({ params: paramsFor(league.id) });

    const starters = findElementsByType(page, StartDraftForm);
    expect(starters).toHaveLength(1);
    expect(starters[0].props.isFull).toBe(true);
  });

  it("does not render a Start Draft control for a non-commissioner member, showing status text instead", async () => {
    const owner = await createTestUser();
    const joiner = await createTestUser();
    authMock.mockResolvedValue({ user: { id: joiner.id } });
    const { league } = await testLeague(owner.id, 4);
    await prisma.leagueMember.create({
      data: { leagueId: league.id, userId: joiner.id, draftSlot: 2 },
    });

    const page = await DraftPage({ params: paramsFor(league.id) });

    expect(findElementsByType(page, StartDraftForm)).toHaveLength(0);
  });

  it("renders a Join Draft Room link and no pre-draft UI once the Draft is ACTIVE", async () => {
    const owner = await createTestUser();
    authMock.mockResolvedValue({ user: { id: owner.id } });
    const { league } = await testLeague(owner.id, 4);
    await fillRemainingSlots(league.id, 4);
    await startDraft(league.id, owner.id);

    const page = await DraftPage({ params: paramsFor(league.id) });

    expect(findElementsByType(page, StartDraftForm)).toHaveLength(0);
    expect(findElementsByType(page, DraftBoard)).toHaveLength(0);
    const links = findElementsByType(page, Link).filter(
      (link) => link.props.href === `/leagues/${league.id}/draft/room`,
    );
    expect(links).toHaveLength(1);
    expect(links[0]!.props.children).toBe("Join Draft Room");
  });

  it("renders a View Draft Room link once the Draft is COMPLETE", async () => {
    const owner = await createTestUser();
    authMock.mockResolvedValue({ user: { id: owner.id } });
    // A 1-team, 1-round league completes on its own single pick.
    const { league } = await createLeague(
      {
        name: "Pre-Draft Complete Test League",
        rosterSize: 1,
        teamCount: 1,
        timerSeconds: 60,
        scoringFormat: "PPR",
        draftType: "SNAKE",
      },
      owner.id,
    );
    await startDraft(league.id, owner.id);
    const player = await createTestPlayer({ fullName: "Only Player" });
    await submitPick(league.id, owner.id, player.id);

    const page = await DraftPage({ params: paramsFor(league.id) });

    const links = findElementsByType(page, Link).filter(
      (link) => link.props.href === `/leagues/${league.id}/draft/room`,
    );
    expect(links).toHaveLength(1);
    expect(links[0]!.props.children).toBe("View Draft Room");
  });
});
