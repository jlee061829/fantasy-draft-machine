import { prisma } from "@fdm/database";
import { cleanupLeagueTestData, createTestUser } from "@fdm/database/test-support";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { POST } from "./route";

const authMock = vi.fn();

vi.mock("../../../../lib/auth", () => ({
  auth: () => authMock(),
}));

describe("POST /api/socket/ticket", () => {
  beforeEach(async () => {
    authMock.mockReset();
    await cleanupLeagueTestData();
  });

  afterEach(async () => {
    await cleanupLeagueTestData();
  });

  it("rejects an unauthenticated request with 401 and mints nothing", async () => {
    authMock.mockResolvedValue(null);

    const response = await POST();

    expect(response.status).toBe(401);
    expect(await prisma.socketTicket.count()).toBe(0);
  });

  it("mints a ticket for the authenticated user and returns 201", async () => {
    const user = await createTestUser();
    authMock.mockResolvedValue({ user: { id: user.id } });

    const response = await POST();
    const body = await response.json();

    expect(response.status).toBe(201);
    expect(typeof body.token).toBe("string");
    expect(new Date(body.expiresAt).getTime()).toBeGreaterThan(Date.now());

    const ticket = await prisma.socketTicket.findUnique({ where: { token: body.token } });
    expect(ticket?.userId).toBe(user.id);
    expect(ticket?.consumedAt).toBeNull();
  });
});
