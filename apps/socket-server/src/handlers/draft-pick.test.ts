import { createSocketTicket, prisma, submitPick } from "@fdm/database";
import { cleanupLeagueTestData } from "@fdm/database/test-support";
import type { DraftStateResult } from "@fdm/shared";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createPickRateLimiter } from "../pick-rate-limiter.js";
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
    const { league, draft, membersBySlot, owner } = await startFullDraft({ teamCount: 4 });
    const player = await createTestPlayer();

    // Pick 1 always belongs to slot 1 (the owner) under startFullDraft's own
    // invariant. Sockets always authenticate as a human (userId), never a
    // membership id.
    const pickerTicket = await createSocketTicket(owner.id);
    const pickerSocket = await connectClient(baseUrl, pickerTicket.token);
    await joinDraft(pickerSocket, { leagueId: league.id });

    // A second, uninvolved member in the same room to prove the broadcast
    // reaches every socket, not just the submitter.
    const observerTicket = await createSocketTicket(membersBySlot[2]!);
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
    expect(persistedPick?.leagueMemberId).toBe(draft.currentMemberId);

    const broadcastState = await broadcastPromise;
    expect(broadcastState.draft?.currentPickNumber).toBe(2);
    expect(broadcastState.picks).toHaveLength(1);

    pickerSocket.disconnect();
    observerSocket.disconnect();
  });

  it("rejects a non-current picker and leaves state unchanged", async () => {
    const { league, draft, membersBySlot } = await startFullDraft({ teamCount: 4 });
    const player = await createTestPlayer();
    const notOnClock = membersBySlot[2]!;

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
    const { league, owner } = await startFullDraft({ teamCount: 4 });
    const ticket = await createSocketTicket(owner.id);
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
    const { league, membersBySlot, owner } = await startFullDraft({ teamCount: 4 });
    const player = await createTestPlayer();

    const firstTicket = await createSocketTicket(owner.id);
    const firstSocket = await connectClient(baseUrl, firstTicket.token);
    await joinDraft(firstSocket, { leagueId: league.id });
    const firstAck = await submitDraftPick(firstSocket, { leagueId: league.id, playerId: player.id });
    expect(firstAck).toEqual({ ok: true });

    const secondPicker = membersBySlot[2]!;
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
    // Tracks the current LeagueMember.id (what Draft.currentMemberId
    // actually stores); resolved to a userId only when a ticket needs
    // minting, since sockets always authenticate as a human.
    let currentMemberId = draft.currentMemberId!;
    for (const player of players) {
      const currentMember = await prisma.leagueMember.findUniqueOrThrow({
        where: { id: currentMemberId },
      });
      const ticket = await createSocketTicket(currentMember.userId!);
      const socket = await connectClient(baseUrl, ticket.token);
      await joinDraft(socket, { leagueId: league.id });
      const ack = await submitDraftPick(socket, { leagueId: league.id, playerId: player.id });
      expect(ack.ok).toBe(true);
      const persisted = await prisma.draft.findUnique({ where: { id: draft.id } });
      // On the final pick, persisted.currentMemberId is cleared to null —
      // `?? currentMemberId` keeps the last real picker, mirroring the
      // pre-5.1 currentUserId fallback this replaces.
      currentMemberId = persisted?.currentMemberId ?? currentMemberId;
      socket.disconnect();
    }

    const completed = await prisma.draft.findUnique({ where: { id: draft.id } });
    expect(completed?.status).toBe("COMPLETE");

    const lastMember = await prisma.leagueMember.findUniqueOrThrow({
      where: { id: currentMemberId },
    });
    const extraTicket = await createSocketTicket(lastMember.userId!);
    const extraSocket = await connectClient(baseUrl, extraTicket.token);
    await joinDraft(extraSocket, { leagueId: league.id });
    const extraPlayer = await createTestPlayer();

    const ack = await submitDraftPick(extraSocket, { leagueId: league.id, playerId: extraPlayer.id });

    expect(ack).toEqual({ ok: false, error: "DRAFT_NOT_ACTIVE" });

    extraSocket.disconnect();
  });

  it("rejects a malformed payload", async () => {
    const { league, owner } = await startFullDraft({ teamCount: 4 });
    const ticket = await createSocketTicket(owner.id);
    const socket = await connectClient(baseUrl, ticket.token);
    await joinDraft(socket, { leagueId: league.id });

    // @ts-expect-error -- deliberately malformed for the test
    const ack = await submitDraftPick(socket, { leagueId: league.id });

    expect(ack).toEqual({ ok: false, error: "INVALID_PAYLOAD" });

    socket.disconnect();
  });

  it("rejects a socket that never called draft:join", async () => {
    const { league, owner } = await startFullDraft({ teamCount: 4 });
    const player = await createTestPlayer();
    const ticket = await createSocketTicket(owner.id);
    const socket = await connectClient(baseUrl, ticket.token);
    // Deliberately no joinDraft(...) call here.

    const ack = await submitDraftPick(socket, { leagueId: league.id, playerId: player.id });

    expect(ack).toEqual({ ok: false, error: "NOT_JOINED" });

    socket.disconnect();
  });

  it("rejects a payload with an extra client-supplied userId and derives identity only from the authenticated ticket", async () => {
    const { league, draft, membersBySlot, membershipsBySlot, owner } = await startFullDraft({
      teamCount: 4,
    });
    const player = await createTestPlayer();
    const notOnClock = membersBySlot[2]!;
    // Authenticate as the picker who IS on the clock, but attempt to smuggle
    // a different userId in the payload to see if it's honored.
    const ticket = await createSocketTicket(owner.id);
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
    // Pick is attributed to the authenticated ticket's own membership (the
    // real current picker), never to any client-supplied value.
    const realAck = await submitDraftPick(socket, { leagueId: league.id, playerId: player.id });
    expect(realAck).toEqual({ ok: true });
    const persisted = await prisma.pick.findUnique({
      where: { draftId_playerId: { draftId: draft.id, playerId: player.id } },
    });
    expect(persisted?.leagueMemberId).toBe(draft.currentMemberId);
    expect(persisted?.leagueMemberId).not.toBe(membershipsBySlot[2]);

    socket.disconnect();
  });

  it("does not broadcast on a rejected pick", async () => {
    const { league, membersBySlot, owner } = await startFullDraft({ teamCount: 4 });
    const player = await createTestPlayer();
    const notOnClock = membersBySlot[2]!;

    const observerTicket = await createSocketTicket(owner.id);
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

// Phase 6.3: draft:pick rate limiting. These run against a dedicated server
// whose limiter uses a frozen clock, so no token can refill mid-test and
// every assertion is deterministic without sleeping. Each test builds fresh
// users via startFullDraft, so buckets never carry over between tests even
// though the limiter instance is shared across this describe block — which
// is itself the production shape (one limiter per server process).
describe("draft:pick rate limiting", () => {
  let limitedHandle: SocketServerHandle;
  let limitedBaseUrl: string;

  beforeAll(async () => {
    const frozenNow = Date.now();
    ({ handle: limitedHandle, baseUrl: limitedBaseUrl } = await startTestServer({
      pickRateLimiter: createPickRateLimiter({ now: () => frozenNow }),
    }));
  });

  afterAll(async () => {
    await stopTestServer(limitedHandle);
  });

  beforeEach(async () => {
    await cleanupLeagueTestData();
  });

  afterEach(async () => {
    await cleanupLeagueTestData();
  });

  async function connectAndJoin(userId: string, leagueId: string) {
    const ticket = await createSocketTicket(userId);
    const socket = await connectClient(limitedBaseUrl, ticket.token);
    await joinDraft(socket, { leagueId });
    return socket;
  }

  it("lets an off-turn member's first 3 attempts reach real draft handling, then throttles the 4th", async () => {
    const { league, draft, owner, membersBySlot, membershipsBySlot } = await startFullDraft({
      teamCount: 4,
    });
    const [playerX, playerY, playerZ] = await Promise.all([
      createTestPlayer(),
      createTestPlayer(),
      createTestPlayer(),
    ]);
    const socket = await connectAndJoin(membersBySlot[2]!, league.id);

    // Attempt 1: slot 1 is on the clock, so submitPick's locked turn check
    // rejects it.
    const first = await submitDraftPick(socket, { leagueId: league.id, playerId: playerX.id });
    expect(first).toEqual({ ok: false, error: "NOT_ON_THE_CLOCK" });

    // Advance the draft outside the socket transport (the direct service is
    // never rate limited): slot 1 takes playerX, putting slot 2 on the clock.
    await submitPick(league.id, owner.id, playerX.id);

    // Attempts 2 and 3 produce outcomes that only live database state can
    // explain — proof these went through submitPick, not a string-matching
    // shortcut: playerX is now drafted, and slot 2 is now legitimately on
    // the clock and actually persists a Pick.
    const second = await submitDraftPick(socket, { leagueId: league.id, playerId: playerX.id });
    expect(second).toEqual({ ok: false, error: "PLAYER_ALREADY_DRAFTED" });

    const third = await submitDraftPick(socket, { leagueId: league.id, playerId: playerY.id });
    expect(third).toEqual({ ok: true });
    const slot2Pick = await prisma.pick.findUnique({
      where: { draftId_playerId: { draftId: draft.id, playerId: playerY.id } },
    });
    expect(slot2Pick?.leagueMemberId).toBe(membershipsBySlot[2]);

    // Attempt 4: bucket exhausted — rejected before any DB work.
    const fourth = await submitDraftPick(socket, { leagueId: league.id, playerId: playerZ.id });
    expect(fourth).toEqual({ ok: false, error: "RATE_LIMITED" });

    expect(await prisma.pick.count({ where: { draftId: draft.id } })).toBe(2);
    const persisted = await prisma.draft.findUnique({ where: { id: draft.id } });
    expect(persisted?.currentPickNumber).toBe(3);

    socket.disconnect();
  });

  it("throttles exactly one of 4 simultaneous off-turn attempts; the other 3 reach the turn check", async () => {
    const { league, draft, membersBySlot } = await startFullDraft({ teamCount: 4 });
    const player = await createTestPlayer();
    const socket = await connectAndJoin(membersBySlot[2]!, league.id);

    const acks = await Promise.all(
      Array.from({ length: 4 }, () =>
        submitDraftPick(socket, { leagueId: league.id, playerId: player.id }),
      ),
    );

    expect(acks.filter((a) => !a.ok && a.error === "NOT_ON_THE_CLOCK")).toHaveLength(3);
    expect(acks.filter((a) => !a.ok && a.error === "RATE_LIMITED")).toHaveLength(1);
    expect(await prisma.pick.count({ where: { draftId: draft.id } })).toBe(0);

    socket.disconnect();
  });

  it("a throttled on-turn user creates no Pick, does not advance the Draft, and triggers no broadcast", async () => {
    const { league, draft, owner, membersBySlot } = await startFullDraft({ teamCount: 4 });
    const player = await createTestPlayer();

    const observer = await connectAndJoin(membersBySlot[2]!, league.id);
    let broadcastReceived = false;
    observer.on("draft:state", () => {
      broadcastReceived = true;
    });

    const picker = await connectAndJoin(owner.id, league.id);

    // The owner is on the clock; spend all 3 tokens on requests submitPick
    // itself rejects (unknown player), each of which reached the database.
    for (let i = 0; i < 3; i += 1) {
      const ack = await submitDraftPick(picker, {
        leagueId: league.id,
        playerId: `nonexistent-player-${i}`,
      });
      expect(ack).toEqual({ ok: false, error: "PLAYER_NOT_FOUND" });
    }

    // A perfectly valid on-turn pick is now throttled.
    const throttled = await submitDraftPick(picker, { leagueId: league.id, playerId: player.id });
    expect(throttled).toEqual({ ok: false, error: "RATE_LIMITED" });

    expect(await prisma.pick.count({ where: { draftId: draft.id } })).toBe(0);
    const persisted = await prisma.draft.findUnique({ where: { id: draft.id } });
    expect(persisted?.currentPickNumber).toBe(1);
    expect(persisted?.currentMemberId).toBe(draft.currentMemberId);
    expect(persisted?.turnDeadline?.getTime()).toBe(draft.turnDeadline?.getTime());

    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(broadcastReceived).toBe(false);

    observer.disconnect();
    picker.disconnect();
  });

  it("does not affect a second user when the first user's bucket is exhausted", async () => {
    const { league, draft, owner, membersBySlot } = await startFullDraft({ teamCount: 4 });
    const player = await createTestPlayer();

    const spammer = await connectAndJoin(membersBySlot[2]!, league.id);
    for (let i = 0; i < 3; i += 1) {
      await submitDraftPick(spammer, { leagueId: league.id, playerId: player.id });
    }
    expect(await submitDraftPick(spammer, { leagueId: league.id, playerId: player.id })).toEqual({
      ok: false,
      error: "RATE_LIMITED",
    });

    // Another off-turn member still reaches the normal turn check...
    const bystander = await connectAndJoin(membersBySlot[3]!, league.id);
    expect(await submitDraftPick(bystander, { leagueId: league.id, playerId: player.id })).toEqual({
      ok: false,
      error: "NOT_ON_THE_CLOCK",
    });

    // ...and the on-the-clock user picks normally, with a broadcast.
    const picker = await connectAndJoin(owner.id, league.id);
    const broadcast = new Promise<DraftStateResult>((resolve) => {
      spammer.once("draft:state", resolve);
    });
    expect(await submitDraftPick(picker, { leagueId: league.id, playerId: player.id })).toEqual({
      ok: true,
    });
    expect((await broadcast).draft?.currentPickNumber).toBe(2);
    expect(await prisma.pick.count({ where: { draftId: draft.id } })).toBe(1);

    spammer.disconnect();
    bystander.disconnect();
    picker.disconnect();
  });

  it("makes every socket for the same authenticated user share one bucket, including a fresh reconnect", async () => {
    const { league, membersBySlot } = await startFullDraft({ teamCount: 4 });
    const player = await createTestPlayer();
    const userId = membersBySlot[2]!;

    const socketA = await connectAndJoin(userId, league.id);
    const socketB = await connectAndJoin(userId, league.id);

    const payload = { leagueId: league.id, playerId: player.id };
    expect(await submitDraftPick(socketA, payload)).toEqual({ ok: false, error: "NOT_ON_THE_CLOCK" });
    expect(await submitDraftPick(socketB, payload)).toEqual({ ok: false, error: "NOT_ON_THE_CLOCK" });
    expect(await submitDraftPick(socketA, payload)).toEqual({ ok: false, error: "NOT_ON_THE_CLOCK" });

    expect(await submitDraftPick(socketB, payload)).toEqual({ ok: false, error: "RATE_LIMITED" });
    expect(await submitDraftPick(socketA, payload)).toEqual({ ok: false, error: "RATE_LIMITED" });

    // A brand-new socket (fresh ticket, as on reconnect) does not reset it.
    const socketC = await connectAndJoin(userId, league.id);
    expect(await submitDraftPick(socketC, payload)).toEqual({ ok: false, error: "RATE_LIMITED" });

    socketA.disconnect();
    socketB.disconnect();
    socketC.disconnect();
  });

  it("does not spend tokens on invalid payloads or unjoined-room requests", async () => {
    const { league, membersBySlot } = await startFullDraft({ teamCount: 4 });
    const otherLeague = await createTestLeague((await createTestUser()).id);
    const player = await createTestPlayer();
    const socket = await connectAndJoin(membersBySlot[2]!, league.id);

    for (let i = 0; i < 5; i += 1) {
      // @ts-expect-error — deliberately malformed payload (missing playerId)
      expect(await submitDraftPick(socket, { leagueId: league.id })).toEqual({
        ok: false,
        error: "INVALID_PAYLOAD",
      });
      expect(
        await submitDraftPick(socket, { leagueId: otherLeague.id, playerId: player.id }),
      ).toEqual({ ok: false, error: "NOT_JOINED" });
    }

    const payload = { leagueId: league.id, playerId: player.id };
    for (let i = 0; i < 3; i += 1) {
      expect(await submitDraftPick(socket, payload)).toEqual({
        ok: false,
        error: "NOT_ON_THE_CLOCK",
      });
    }
    expect(await submitDraftPick(socket, payload)).toEqual({ ok: false, error: "RATE_LIMITED" });

    socket.disconnect();
  });

  it("still lets two simultaneous same-user sockets reach the database correctness layer", async () => {
    const { league, draft, owner } = await startFullDraft({ teamCount: 4 });
    const player = await createTestPlayer();
    const socketA = await connectAndJoin(owner.id, league.id);
    const socketB = await connectAndJoin(owner.id, league.id);

    const acks = await Promise.all([
      submitDraftPick(socketA, { leagueId: league.id, playerId: player.id }),
      submitDraftPick(socketB, { leagueId: league.id, playerId: player.id }),
    ]);

    expect(acks.filter((a) => a.ok)).toHaveLength(1);
    expect(acks.filter((a) => !a.ok)).toEqual([{ ok: false, error: "NOT_ON_THE_CLOCK" }]);
    expect(await prisma.pick.count({ where: { draftId: draft.id } })).toBe(1);

    socketA.disconnect();
    socketB.disconnect();
  });
});
