import { createSocketTicket, prisma, submitPick } from "@fdm/database";
import { cleanupLeagueTestData } from "@fdm/database/test-support";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { SocketServerHandle } from "./server.js";
import {
  connectClient,
  createTestPlayer,
  joinDraft,
  startFullDraft,
  startTestServer,
  stopTestServer,
  submitDraftPick,
} from "./test-support.js";

let handle: SocketServerHandle;
let baseUrl: string;

beforeAll(async () => {
  ({ handle, baseUrl } = await startTestServer());
});

afterAll(async () => {
  await stopTestServer(handle);
});

describe("concurrency: shared submitPick service vs. the socket transport", () => {
  beforeEach(async () => {
    await cleanupLeagueTestData();
  });

  afterEach(async () => {
    await cleanupLeagueTestData();
  });

  it("racing one direct submitPick(...) call against one real draft:pick emit for the same turn lets exactly one win", async () => {
    const { league, draft } = await startFullDraft({ teamCount: 4 });
    const player = await createTestPlayer();
    const currentUserId = draft.currentUserId!;

    const ticket = await createSocketTicket(currentUserId);
    const socket = await connectClient(baseUrl, ticket.token);
    await joinDraft(socket, { leagueId: league.id });

    const [directOutcome, socketAck] = await Promise.all([
      submitPick(league.id, currentUserId, player.id).then(
        (result) => ({ status: "fulfilled" as const, result }),
        (error: unknown) => ({ status: "rejected" as const, error }),
      ),
      submitDraftPick(socket, { leagueId: league.id, playerId: player.id }),
    ]);

    // Exactly one of the two paths actually consumed the turn.
    const directWon = directOutcome.status === "fulfilled";
    const socketWon = socketAck.ok === true;
    expect(directWon !== socketWon).toBe(true);
    if (!directWon) {
      expect(directOutcome).toMatchObject({ status: "rejected" });
    }
    if (!socketWon) {
      expect(socketAck).toEqual({ ok: false, error: "NOT_ON_THE_CLOCK" });
    }

    const pickCount = await prisma.pick.count({ where: { draftId: draft.id } });
    expect(pickCount).toBe(1);
    const persisted = await prisma.draft.findUnique({ where: { id: draft.id } });
    expect(persisted?.currentPickNumber).toBe(2);
    expect(persisted?.currentUserId).not.toBeNull();

    socket.disconnect();
  });

  it("racing two authenticated sockets for the same turn lets exactly one win and broadcasts exactly one authoritative state", async () => {
    const { league, draft } = await startFullDraft({ teamCount: 4 });
    const player = await createTestPlayer();
    const currentUserId = draft.currentUserId!;

    // Two sockets both authenticated as the current picker (multi-tab
    // scenario) racing the exact same turn/player.
    const ticketA = await createSocketTicket(currentUserId);
    const ticketB = await createSocketTicket(currentUserId);
    const socketA = await connectClient(baseUrl, ticketA.token);
    const socketB = await connectClient(baseUrl, ticketB.token);
    await Promise.all([
      joinDraft(socketA, { leagueId: league.id }),
      joinDraft(socketB, { leagueId: league.id }),
    ]);

    let broadcastCount = 0;
    socketA.on("draft:state", () => {
      broadcastCount += 1;
    });

    const [ackA, ackB] = await Promise.all([
      submitDraftPick(socketA, { leagueId: league.id, playerId: player.id }),
      submitDraftPick(socketB, { leagueId: league.id, playerId: player.id }),
    ]);

    const oks = [ackA, ackB].filter((ack) => ack.ok);
    const failures = [ackA, ackB].filter((ack) => !ack.ok);
    expect(oks).toHaveLength(1);
    expect(failures).toHaveLength(1);
    expect(failures[0]).toEqual({ ok: false, error: "NOT_ON_THE_CLOCK" });

    const pickCount = await prisma.pick.count({ where: { draftId: draft.id } });
    expect(pickCount).toBe(1);

    // Give the broadcast a moment to arrive, then confirm exactly one.
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(broadcastCount).toBe(1);

    socketA.disconnect();
    socketB.disconnect();
  });
});
