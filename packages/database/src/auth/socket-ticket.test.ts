import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { prisma } from "../client.js";
import { cleanupLeagueTestData, createTestUser } from "../test-support/db.js";
import { consumeSocketTicket, createSocketTicket } from "./socket-ticket.js";

describe("createSocketTicket / consumeSocketTicket", () => {
  beforeEach(async () => {
    await cleanupLeagueTestData();
  });

  afterEach(async () => {
    await cleanupLeagueTestData();
  });

  it("mints a ticket that resolves to the minting user's id exactly once", async () => {
    const user = await createTestUser();
    const { token, expiresAt } = await createSocketTicket(user.id);

    expect(token).toBeTruthy();
    expect(new Date(expiresAt).getTime()).toBeGreaterThan(Date.now());

    const first = await consumeSocketTicket(token);
    expect(first).toEqual({ userId: user.id });

    const second = await consumeSocketTicket(token);
    expect(second).toBeNull();
  });

  it("rejects an unknown token", async () => {
    await expect(consumeSocketTicket("does-not-exist")).resolves.toBeNull();
  });

  it("rejects an expired token", async () => {
    const user = await createTestUser();
    const { token } = await createSocketTicket(user.id);
    await prisma.socketTicket.update({
      where: { token },
      data: { expiresAt: new Date(Date.now() - 1_000) },
    });

    await expect(consumeSocketTicket(token)).resolves.toBeNull();
  });

  it("lets two concurrent consumption attempts race but only one ever wins", async () => {
    const user = await createTestUser();
    const { token } = await createSocketTicket(user.id);

    const results = await Promise.all([consumeSocketTicket(token), consumeSocketTicket(token)]);
    const successes = results.filter((result) => result !== null);

    expect(successes).toHaveLength(1);
    expect(successes[0]).toEqual({ userId: user.id });
  });
});
