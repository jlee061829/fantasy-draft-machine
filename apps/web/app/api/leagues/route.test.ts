import { prisma } from "@fdm/database";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanupLeagueTestData, createTestUser } from "../../../test/db";
import { POST } from "./route";

const authMock = vi.fn();

vi.mock("../../../lib/auth", () => ({
  auth: () => authMock(),
}));

function jsonRequest(body: unknown) {
  return new Request("http://localhost/api/leagues", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

function validBody(overrides: Record<string, unknown> = {}) {
  return {
    name: "Route Test League",
    rosterSize: 16,
    timerSeconds: 60,
    scoringFormat: "PPR",
    draftType: "SNAKE",
    ...overrides,
  };
}

describe("POST /api/leagues", () => {
  beforeEach(async () => {
    authMock.mockReset();
    await cleanupLeagueTestData();
  });

  afterEach(async () => {
    await cleanupLeagueTestData();
  });

  it("rejects an unauthenticated request with 401 and creates nothing", async () => {
    authMock.mockResolvedValue(null);

    const response = await POST(jsonRequest(validBody()));

    expect(response.status).toBe(401);
    expect(await prisma.league.count()).toBe(0);
  });

  it("rejects invalid input with 400 and creates nothing", async () => {
    const user = await createTestUser();
    authMock.mockResolvedValue({ user: { id: user.id } });

    const response = await POST(jsonRequest(validBody({ rosterSize: 999 })));

    expect(response.status).toBe(400);
    expect(await prisma.league.count()).toBe(0);
  });

  it("rejects an otherwise-valid request containing an unexpected field with 400", async () => {
    const user = await createTestUser();
    authMock.mockResolvedValue({ user: { id: user.id } });

    const response = await POST(jsonRequest(validBody({ ownerId: "spoofed-id" })));

    expect(response.status).toBe(400);
    expect(await prisma.league.count()).toBe(0);
  });

  it("creates a league for the authenticated user and returns 201 with the DTO", async () => {
    const user = await createTestUser();
    authMock.mockResolvedValue({ user: { id: user.id } });

    const response = await POST(jsonRequest(validBody({ name: "Wired League" })));
    const body = await response.json();

    expect(response.status).toBe(201);
    expect(body.league.ownerId).toBe(user.id);
    expect(body.membership.draftSlot).toBe(1);

    const league = await prisma.league.findUnique({ where: { id: body.league.id } });
    expect(league?.ownerId).toBe(user.id);
  });
});
