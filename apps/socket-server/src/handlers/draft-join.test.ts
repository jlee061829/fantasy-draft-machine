import { createSocketTicket, getDraftState } from "@fdm/database";
import { cleanupLeagueTestData } from "@fdm/database/test-support";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { leagueRoomName } from "../rooms.js";
import type { SocketServerHandle } from "../server.js";
import {
  addMember,
  connectClient,
  createTestLeague,
  createTestUser,
  joinDraft,
  startTestServer,
  stopTestServer,
} from "../test-support.js";

let handle: SocketServerHandle;
let baseUrl: string;

beforeAll(async () => {
  ({ handle, baseUrl } = await startTestServer());
});

afterAll(async () => {
  await stopTestServer(handle);
});

describe("draft:join", () => {
  beforeEach(async () => {
    await cleanupLeagueTestData();
  });

  afterEach(async () => {
    await cleanupLeagueTestData();
  });

  it("lets an authenticated LeagueMember join and returns authoritative state matching getDraftState", async () => {
    const owner = await createTestUser();
    const league = await createTestLeague(owner.id);
    await addMember(league.id, owner.id, 1);
    const ticket = await createSocketTicket(owner.id);
    const socket = await connectClient(baseUrl, ticket.token);

    const ack = await joinDraft(socket, { leagueId: league.id });

    expect(ack.ok).toBe(true);
    if (!ack.ok) throw new Error("unreachable");
    const expected = await getDraftState(league.id, owner.id);
    expect(ack.state).toEqual(expected);

    socket.disconnect();
  });

  it("rejects a nonexistent league without joining any room", async () => {
    const user = await createTestUser();
    const ticket = await createSocketTicket(user.id);
    const socket = await connectClient(baseUrl, ticket.token);

    const ack = await joinDraft(socket, { leagueId: "nonexistent-league-id" });

    expect(ack).toEqual({ ok: false, error: "LEAGUE_NOT_ACCESSIBLE" });
    // No room is ever created for a rejected join — check server-side room
    // membership directly rather than relying on the client's own view.
    expect(
      handle.io.sockets.adapter.rooms.get(leagueRoomName("nonexistent-league-id")),
    ).toBeUndefined();

    socket.disconnect();
  });

  it("rejects an authenticated non-member without joining the room", async () => {
    const owner = await createTestUser();
    const league = await createTestLeague(owner.id);
    await addMember(league.id, owner.id, 1);
    const outsider = await createTestUser();
    const ticket = await createSocketTicket(outsider.id);
    const socket = await connectClient(baseUrl, ticket.token);

    const ack = await joinDraft(socket, { leagueId: league.id });

    expect(ack).toEqual({ ok: false, error: "LEAGUE_NOT_ACCESSIBLE" });
    const room = handle.io.sockets.adapter.rooms.get(leagueRoomName(league.id));
    expect(room?.has(socket.id ?? "")).not.toBe(true);

    socket.disconnect();
  });

  it("rejects a malformed payload", async () => {
    const user = await createTestUser();
    const ticket = await createSocketTicket(user.id);
    const socket = await connectClient(baseUrl, ticket.token);

    // @ts-expect-error -- deliberately malformed for the test
    const ack = await joinDraft(socket, { leagueId: 12345 });

    expect(ack).toEqual({ ok: false, error: "INVALID_PAYLOAD" });

    socket.disconnect();
  });

  it("rejects a payload carrying an unexpected extra field (e.g. a client-supplied userId)", async () => {
    const owner = await createTestUser();
    const league = await createTestLeague(owner.id);
    await addMember(league.id, owner.id, 1);
    const ticket = await createSocketTicket(owner.id);
    const socket = await connectClient(baseUrl, ticket.token);

    const ack = await joinDraft(socket, {
      leagueId: league.id,
      // @ts-expect-error -- deliberately smuggling an extra field
      userId: "someone-elses-id",
    });

    expect(ack).toEqual({ ok: false, error: "INVALID_PAYLOAD" });

    socket.disconnect();
  });

  it("lets two sockets authenticated as the same user independently join", async () => {
    const owner = await createTestUser();
    const league = await createTestLeague(owner.id);
    await addMember(league.id, owner.id, 1);
    const ticketA = await createSocketTicket(owner.id);
    const ticketB = await createSocketTicket(owner.id);
    const socketA = await connectClient(baseUrl, ticketA.token);
    const socketB = await connectClient(baseUrl, ticketB.token);

    const [ackA, ackB] = await Promise.all([
      joinDraft(socketA, { leagueId: league.id }),
      joinDraft(socketB, { leagueId: league.id }),
    ]);

    expect(ackA.ok).toBe(true);
    expect(ackB.ok).toBe(true);

    socketA.disconnect();
    socketB.disconnect();
  });
});
