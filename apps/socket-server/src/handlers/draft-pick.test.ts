import { createSocketTicket, prisma } from "@fdm/database";
import { cleanupLeagueTestData } from "@fdm/database/test-support";
import type { DraftStateResult } from "@fdm/shared";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { SocketServerHandle } from "../server.js";
import {
  addMember,
  connectClient,
  createTestLeague,
  createTestPlayer,
  createTestUser,
  joinDraft,
  startFullDraft,
  startTestServer,
  stopTestServer,
  submitDraftPick,
} from "../test-support.js";

let handle: SocketServerHandle;
let baseUrl: string;

beforeAll(async () => {
  ({ handle, baseUrl } = await startTestServer());
});

afterAll(async () => {
  await stopTestServer(handle);
});

describe("draft:pick", () => {
  beforeEach(async () => {
    await cleanupLeagueTestData();
  });

  afterEach(async () => {
    await cleanupLeagueTestData();
  });

  it("lets the current picker submit a valid player, persists the pick, and broadcasts updated state to the room", async () => {
    const { league, draft, membersBySlot } = await startFullDraft({ teamCount: 4 });
    const player = await createTestPlayer();

    const pickerTicket = await createSocketTicket(draft.currentUserId!);
    const pickerSocket = await connectClient(baseUrl, pickerTicket.token);
    await joinDraft(pickerSocket, { leagueId: league.id });

    // A second, uninvolved member in the same room to prove the broadcast
    // reaches every socket, not just the submitter.
    const observerTicket = await createSocketTicket(membersBySlot[2]);
    const observerSocket = await connectClient(baseUrl, observerTicket.token);
    await joinDraft(observerSocket, { leagueId: league.id });

    const broadcastPromise = new Promise<DraftStateResult>((resolve) => {
      observerSocket.once("draft:state", resolve);
    });

    const ack = await submitDraftPick(pickerSocket, { leagueId: league.id, playerId: player.id });

    expect(ack).toEqual({ ok: true });

    const pickCount = await prisma.pick.count({ where: { draftId: draft.id, playerId: player.id } });
    expect(pickCount).toBe(1);
    const persistedPick = await prisma.pick.findUnique({
      where: { draftId_playerId: { draftId: draft.id, playerId: player.id } },
    });
    expect(persistedPick?.userId).toBe(draft.currentUserId);

    const broadcastState = await broadcastPromise;
    expect(broadcastState.draft?.currentPickNumber).toBe(2);
    expect(broadcastState.picks).toHaveLength(1);

    pickerSocket.disconnect();
    observerSocket.disconnect();
  });

  it("rejects a non-current picker and leaves state unchanged", async () => {
    const { league, draft, membersBySlot } = await startFullDraft({ teamCount: 4 });
    const player = await createTestPlayer();
    const notOnClock = membersBySlot[2];

    const ticket = await createSocketTicket(notOnClock);
    const socket = await connectClient(baseUrl, ticket.token);
    await joinDraft(socket, { leagueId: league.id });

    const ack = await submitDraftPick(socket, { leagueId: league.id, playerId: player.id });

    expect(ack).toEqual({ ok: false, error: "NOT_ON_THE_CLOCK" });
    const pickCount = await prisma.pick.count({ where: { draftId: draft.id } });
    expect(pickCount).toBe(0);

    socket.disconnect();
  });

  it("rejects an unknown player", async () => {
    const { league, draft } = await startFullDraft({ teamCount: 4 });
    const ticket = await createSocketTicket(draft.currentUserId!);
    const socket = await connectClient(baseUrl, ticket.token);
    await joinDraft(socket, { leagueId: league.id });

    const ack = await submitDraftPick(socket, {
      leagueId: league.id,
      playerId: "nonexistent-player-id",
    });

    expect(ack).toEqual({ ok: false, error: "PLAYER_NOT_FOUND" });

    socket.disconnect();
  });

  it("rejects an already-drafted player", async () => {
    const { league, draft, membersBySlot } = await startFullDraft({ teamCount: 4 });
    const player = await createTestPlayer();

    const firstTicket = await createSocketTicket(draft.currentUserId!);
    const firstSocket = await connectClient(baseUrl, firstTicket.token);
    await joinDraft(firstSocket, { leagueId: league.id });
    const firstAck = await submitDraftPick(firstSocket, { leagueId: league.id, playerId: player.id });
    expect(firstAck).toEqual({ ok: true });

    const secondPicker = membersBySlot[2];
    const secondTicket = await createSocketTicket(secondPicker);
    const secondSocket = await connectClient(baseUrl, secondTicket.token);
    await joinDraft(secondSocket, { leagueId: league.id });

    const secondAck = await submitDraftPick(secondSocket, { leagueId: league.id, playerId: player.id });

    expect(secondAck).toEqual({ ok: false, error: "PLAYER_ALREADY_DRAFTED" });

    firstSocket.disconnect();
    secondSocket.disconnect();
  });

  it("rejects a pick against a draft that hasn't started (DRAFT_NOT_FOUND)", async () => {
    const owner = await createTestUser();
    const league = await createTestLeague(owner.id);
    await addMember(league.id, owner.id, 1);
    const player = await createTestPlayer();
    const ticket = await createSocketTicket(owner.id);
    const socket = await connectClient(baseUrl, ticket.token);
    await joinDraft(socket, { leagueId: league.id });

    const ack = await submitDraftPick(socket, { leagueId: league.id, playerId: player.id });

    expect(ack).toEqual({ ok: false, error: "DRAFT_NOT_FOUND" });

    socket.disconnect();
  });

  it("rejects a pick against a COMPLETE draft (DRAFT_NOT_ACTIVE)", async () => {
    const { league, draft } = await startFullDraft({ teamCount: 4, rosterSize: 1 });
    // rosterSize 1 * teamCount 4 = 4 total picks; drive it to completion.
    const players = await Promise.all(Array.from({ length: 4 }, () => createTestPlayer()));
    let currentUserId = draft.currentUserId!;
    for (const player of players) {
      const ticket = await createSocketTicket(currentUserId);
      const socket = await connectClient(baseUrl, ticket.token);
      await joinDraft(socket, { leagueId: league.id });
      const ack = await submitDraftPick(socket, { leagueId: league.id, playerId: player.id });
      expect(ack.ok).toBe(true);
      const persisted = await prisma.draft.findUnique({ where: { id: draft.id } });
      currentUserId = persisted?.currentUserId ?? currentUserId;
      socket.disconnect();
    }

    const completed = await prisma.draft.findUnique({ where: { id: draft.id } });
    expect(completed?.status).toBe("COMPLETE");

    const extraTicket = await createSocketTicket(currentUserId);
    const extraSocket = await connectClient(baseUrl, extraTicket.token);
    await joinDraft(extraSocket, { leagueId: league.id });
    const extraPlayer = await createTestPlayer();

    const ack = await submitDraftPick(extraSocket, { leagueId: league.id, playerId: extraPlayer.id });

    expect(ack).toEqual({ ok: false, error: "DRAFT_NOT_ACTIVE" });

    extraSocket.disconnect();
  });

  it("rejects a malformed payload", async () => {
    const { league, draft } = await startFullDraft({ teamCount: 4 });
    const ticket = await createSocketTicket(draft.currentUserId!);
    const socket = await connectClient(baseUrl, ticket.token);
    await joinDraft(socket, { leagueId: league.id });

    // @ts-expect-error -- deliberately malformed for the test
    const ack = await submitDraftPick(socket, { leagueId: league.id });

    expect(ack).toEqual({ ok: false, error: "INVALID_PAYLOAD" });

    socket.disconnect();
  });

  it("rejects a socket that never called draft:join", async () => {
    const { league, draft } = await startFullDraft({ teamCount: 4 });
    const player = await createTestPlayer();
    const ticket = await createSocketTicket(draft.currentUserId!);
    const socket = await connectClient(baseUrl, ticket.token);
    // Deliberately no joinDraft(...) call here.

    const ack = await submitDraftPick(socket, { leagueId: league.id, playerId: player.id });

    expect(ack).toEqual({ ok: false, error: "NOT_JOINED" });

    socket.disconnect();
  });

  it("rejects a payload with an extra client-supplied userId and derives identity only from the authenticated ticket", async () => {
    const { league, draft, membersBySlot } = await startFullDraft({ teamCount: 4 });
    const player = await createTestPlayer();
    const notOnClock = membersBySlot[2];
    // Authenticate as the picker who IS on the clock, but attempt to smuggle
    // a different userId in the payload to see if it's honored.
    const ticket = await createSocketTicket(draft.currentUserId!);
    const socket = await connectClient(baseUrl, ticket.token);
    await joinDraft(socket, { leagueId: league.id });

    const smuggledAck = await submitDraftPick(socket, {
      leagueId: league.id,
      playerId: player.id,
      // @ts-expect-error -- deliberately smuggling an extra field
      userId: notOnClock,
    });
    expect(smuggledAck).toEqual({ ok: false, error: "INVALID_PAYLOAD" });

    // The same socket, without the extra field, succeeds and the persisted
    // Pick is attributed to the authenticated ticket's user (the real
    // current picker), never to any client-supplied value.
    const realAck = await submitDraftPick(socket, { leagueId: league.id, playerId: player.id });
    expect(realAck).toEqual({ ok: true });
    const persisted = await prisma.pick.findUnique({
      where: { draftId_playerId: { draftId: draft.id, playerId: player.id } },
    });
    expect(persisted?.userId).toBe(draft.currentUserId);
    expect(persisted?.userId).not.toBe(notOnClock);

    socket.disconnect();
  });

  it("does not broadcast on a rejected pick", async () => {
    const { league, draft, membersBySlot } = await startFullDraft({ teamCount: 4 });
    const player = await createTestPlayer();
    const notOnClock = membersBySlot[2];

    const observerTicket = await createSocketTicket(draft.currentUserId!);
    const observerSocket = await connectClient(baseUrl, observerTicket.token);
    await joinDraft(observerSocket, { leagueId: league.id });

    let broadcastReceived = false;
    observerSocket.once("draft:state", () => {
      broadcastReceived = true;
    });

    const rejectedTicket = await createSocketTicket(notOnClock);
    const rejectedSocket = await connectClient(baseUrl, rejectedTicket.token);
    await joinDraft(rejectedSocket, { leagueId: league.id });
    const ack = await submitDraftPick(rejectedSocket, { leagueId: league.id, playerId: player.id });
    expect(ack).toEqual({ ok: false, error: "NOT_ON_THE_CLOCK" });

    // Give any (incorrect) broadcast a moment to arrive before asserting
    // none did.
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(broadcastReceived).toBe(false);

    observerSocket.disconnect();
    rejectedSocket.disconnect();
  });
});
