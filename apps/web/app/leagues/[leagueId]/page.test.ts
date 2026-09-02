import { prisma } from "@fdm/database";
import Link from "next/link";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanupLeagueTestData, createTestUser } from "@fdm/database/test-support";
import { createLeague } from "../../../lib/leagues/create-league";
import { startDraft } from "../../../lib/drafts/start-draft";
import LeagueDetailPage from "./page";
import { StartDraftForm } from "./start-draft-form";

const authMock = vi.fn();

vi.mock("../../../lib/auth", () => ({
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

// LeagueDetailPage's return value, before any DOM rendering, is just a plain
// React element tree (nested { type, props } objects) — this project has no
// component-rendering test infrastructure (no @testing-library/react, no
// jsdom render calls) anywhere, including for the existing sibling forms, so
// Milestone 4.1 doesn't introduce one solely for this page's new branches.
// This walks that plain tree looking for elements whose `type` matches, the
// same lightweight way the file already just calls the page function and
// inspects what comes back.
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

describe("LeagueDetailPage", () => {
  beforeEach(async () => {
    authMock.mockReset();
    notFoundMock.mockClear();
    await cleanupLeagueTestData();
  });

  afterEach(async () => {
    await cleanupLeagueTestData();
  });

  it("renders the sign-in branch without calling the detail service when unauthenticated", async () => {
    authMock.mockResolvedValue(null);

    await LeagueDetailPage({ params: paramsFor("does-not-matter") });

    expect(notFoundMock).not.toHaveBeenCalled();
  });

  it("calls notFound() for a nonexistent league", async () => {
    const user = await createTestUser();
    authMock.mockResolvedValue({ user: { id: user.id } });

    await expect(LeagueDetailPage({ params: paramsFor("nonexistent-id") })).rejects.toBeInstanceOf(
      NotFoundSentinel,
    );
    expect(notFoundMock).toHaveBeenCalledTimes(1);
  });

  it("calls notFound() for an authenticated non-member", async () => {
    const owner = await createTestUser();
    const outsider = await createTestUser();
    authMock.mockResolvedValue({ user: { id: outsider.id } });

    const { league } = await createLeague(
      {
        name: "Page Test League",
        rosterSize: 16,
        teamCount: 12,
        timerSeconds: 60,
        scoringFormat: "PPR",
        draftType: "SNAKE",
      },
      owner.id,
    );

    await expect(LeagueDetailPage({ params: paramsFor(league.id) })).rejects.toBeInstanceOf(
      NotFoundSentinel,
    );
    expect(notFoundMock).toHaveBeenCalledTimes(1);
  });

  it("does not call notFound() for an authorized member", async () => {
    const owner = await createTestUser();
    authMock.mockResolvedValue({ user: { id: owner.id } });

    const { league } = await createLeague(
      {
        name: "Page Test League",
        rosterSize: 16,
        teamCount: 12,
        timerSeconds: 60,
        scoringFormat: "PPR",
        draftType: "SNAKE",
      },
      owner.id,
    );

    await LeagueDetailPage({ params: paramsFor(league.id) });

    expect(notFoundMock).not.toHaveBeenCalled();
  });

  it("renders a disabled Start Draft control for the commissioner when the league is not full", async () => {
    const owner = await createTestUser();
    authMock.mockResolvedValue({ user: { id: owner.id } });

    const { league } = await createLeague(
      {
        name: "Page Test League",
        rosterSize: 16,
        teamCount: 4,
        timerSeconds: 60,
        scoringFormat: "PPR",
        draftType: "SNAKE",
      },
      owner.id,
    );

    const page = await LeagueDetailPage({ params: paramsFor(league.id) });

    const starters = findElementsByType(page, StartDraftForm);
    expect(starters).toHaveLength(1);
    expect(starters[0].props.isFull).toBe(false);
  });

  it("renders an enabled Start Draft control for the commissioner when the league is full", async () => {
    const owner = await createTestUser();
    authMock.mockResolvedValue({ user: { id: owner.id } });

    const { league } = await createLeague(
      {
        name: "Page Test League",
        rosterSize: 16,
        teamCount: 4,
        timerSeconds: 60,
        scoringFormat: "PPR",
        draftType: "SNAKE",
      },
      owner.id,
    );
    await fillRemainingSlots(league.id, 4);

    const page = await LeagueDetailPage({ params: paramsFor(league.id) });

    const starters = findElementsByType(page, StartDraftForm);
    expect(starters).toHaveLength(1);
    expect(starters[0].props.isFull).toBe(true);
  });

  it("does not render a Start Draft control for a non-commissioner member", async () => {
    const owner = await createTestUser();
    const joiner = await createTestUser();
    authMock.mockResolvedValue({ user: { id: joiner.id } });

    const { league } = await createLeague(
      {
        name: "Page Test League",
        rosterSize: 16,
        teamCount: 4,
        timerSeconds: 60,
        scoringFormat: "PPR",
        draftType: "SNAKE",
      },
      owner.id,
    );
    await prisma.leagueMember.create({
      data: { leagueId: league.id, userId: joiner.id, draftSlot: 2 },
    });

    const page = await LeagueDetailPage({ params: paramsFor(league.id) });

    expect(findElementsByType(page, StartDraftForm)).toHaveLength(0);
  });

  it("renders a link into the draft room instead of a Start Draft control once a Draft exists", async () => {
    const owner = await createTestUser();
    authMock.mockResolvedValue({ user: { id: owner.id } });

    const { league } = await createLeague(
      {
        name: "Page Test League",
        rosterSize: 16,
        teamCount: 4,
        timerSeconds: 60,
        scoringFormat: "PPR",
        draftType: "SNAKE",
      },
      owner.id,
    );
    await fillRemainingSlots(league.id, 4);
    await startDraft(league.id, owner.id);

    const page = await LeagueDetailPage({ params: paramsFor(league.id) });

    expect(findElementsByType(page, StartDraftForm)).toHaveLength(0);
    const links = findElementsByType(page, Link).filter(
      (link) => link.props.href === `/leagues/${league.id}/draft`,
    );
    expect(links).toHaveLength(1);
  });
});
