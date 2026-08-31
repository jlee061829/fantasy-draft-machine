import { createSocketTicket, prisma } from "@fdm/database";
import { cleanupLeagueTestData } from "@fdm/database/test-support";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { SocketServerHandle } from "./server.js";
import { connectClient, createTestUser, startTestServer, stopTestServer } from "./test-support.js";

let handle: SocketServerHandle;
let baseUrl: string;

beforeAll(async () => {
  ({ handle, baseUrl } = await startTestServer());
});

afterAll(async () => {
  await stopTestServer(handle);
});

describe("socket authentication", () => {
  beforeEach(async () => {
    await cleanupLeagueTestData();
  });

  afterEach(async () => {
    await cleanupLeagueTestData();
  });

  it("authenticates with a valid unused ticket", async () => {
    const user = await createTestUser();
    const ticket = await createSocketTicket(user.id);

    const socket = await connectClient(baseUrl, ticket.token);
    expect(socket.connected).toBe(true);
    socket.disconnect();
  });

  it("rejects an unknown token", async () => {
    await expect(connectClient(baseUrl, "nonexistent-token")).rejects.toBeDefined();
  });

  it("rejects an expired ticket", async () => {
    const user = await createTestUser();
    const ticket = await createSocketTicket(user.id);
    // Modify expiresAt directly rather than sleeping past the real 15s TTL,
    // so this test stays fast and deterministic.
    await prisma.socketTicket.update({
      where: { token: ticket.token },
      data: { expiresAt: new Date(Date.now() - 1_000) },
    });

    await expect(connectClient(baseUrl, ticket.token)).rejects.toBeDefined();
  });

  it("rejects an already-consumed ticket", async () => {
    const user = await createTestUser();
    const ticket = await createSocketTicket(user.id);
    const first = await connectClient(baseUrl, ticket.token);
    first.disconnect();

    await expect(connectClient(baseUrl, ticket.token)).rejects.toBeDefined();
  });

  it("lets only one of two concurrent connections sharing one ticket succeed", async () => {
    const user = await createTestUser();
    const ticket = await createSocketTicket(user.id);

    const outcomes = await Promise.allSettled([
      connectClient(baseUrl, ticket.token),
      connectClient(baseUrl, ticket.token),
    ]);

    const fulfilled = outcomes.filter(
      (outcome): outcome is PromiseFulfilledResult<Awaited<ReturnType<typeof connectClient>>> =>
        outcome.status === "fulfilled",
    );
    expect(fulfilled).toHaveLength(1);
    fulfilled[0].value.disconnect();
  });
});
