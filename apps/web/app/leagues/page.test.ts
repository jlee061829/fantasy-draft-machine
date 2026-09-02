import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanupLeagueTestData, createTestUser } from "@fdm/database/test-support";
import MyLeaguesPage from "./page";

const authMock = vi.fn();

vi.mock("../../lib/auth", () => ({
  auth: () => authMock(),
  signIn: vi.fn(),
}));

const getMyLeaguesMock = vi.fn();
vi.mock("../../lib/leagues/get-my-leagues", () => ({
  getMyLeagues: (...args: unknown[]) => getMyLeaguesMock(...args),
}));

describe("MyLeaguesPage", () => {
  beforeEach(async () => {
    authMock.mockReset();
    getMyLeaguesMock.mockReset();
    await cleanupLeagueTestData();
  });

  afterEach(async () => {
    await cleanupLeagueTestData();
  });

  it("renders the sign-in branch without querying leagues when unauthenticated", async () => {
    authMock.mockResolvedValue(null);

    await MyLeaguesPage();

    expect(getMyLeaguesMock).not.toHaveBeenCalled();
  });

  it("queries leagues for the authenticated user's id", async () => {
    const user = await createTestUser();
    authMock.mockResolvedValue({ user: { id: user.id } });
    getMyLeaguesMock.mockResolvedValue([]);

    await MyLeaguesPage();

    expect(getMyLeaguesMock).toHaveBeenCalledWith(user.id);
  });
});
