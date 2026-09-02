import { createSocketTicket, prisma } from "@fdm/database";
import { cleanupLeagueTestData } from "@fdm/database/test-support";
import type { DraftStateResult } from "@fdm/shared";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { SocketServerHandle } from "../server.js";
import {
  connectClient,
  createTestPlayer,
  expireDraftNow,
  joinDraft,
  startFullDraft,
  startTestServer,
  stopTestServer,
} from "../test-support.js";
import { runSweepOnce, startTurnSweep, stopTurnSweep } from "./sweep.js";

let handle: SocketServerHandle;
let baseUrl: string;

beforeAll(async () => {
  ({ handle, baseUrl } = await startTestServer());
});

afterAll(async () => {
  await stopTestServer(handle);
});

describe("runSweepOnce", () => {
  beforeEach(async () => {
    await cleanupLeagueTestData();
  });

  afterEach(async () => {
    await cleanupLeagueTestData();
  });

  it("does not process a draft whose deadline has not passed", async () => {
    // startFullDraft defaults turnDeadline to now + timerSeconds (future) —
    // this is exactly the "process just started, deadline not due yet"
    // shape: no special recovery path is needed because the sweep simply
    // won't discover this draft until its deadline actually elapses.
    const { draft } = await startFullDraft({ teamCount: 4 });
    await prisma.playerAdp.create({
      data: {
        playerId: (await createTestPlayer()).id,
        format: "PPR",
        adp: 1,
        source: "test",
      },
    });

    await runSweepOnce(handle.io);

    const pickCount = await prisma.pick.count({ where: { draftId: draft.id } });
    expect(pickCount).toBe(0);
  });

  it("discovers and processes an already-expired ACTIVE draft on the very first tick (restart-recovery shape)", async () => {
    // Simulates a process starting fresh against a draft whose deadline
    // already elapsed while nothing was running: the draft is expired
    // *before* runSweepOnce is ever called, with no prior in-memory timer
    // state to reconstruct.
    const { league, draft } = await startFullDraft({ teamCount: 4 });
    await expireDraftNow(draft.id);
    await prisma.playerAdp.create({
      data: {
        playerId: (await createTestPlayer()).id,
        format: league.scoringFormat,
        adp: 1,
        source: "test",
      },
    });

    await runSweepOnce(handle.io);

    const pickCount = await prisma.pick.count({ where: { draftId: draft.id } });
    expect(pickCount).toBe(1);
    const persisted = await prisma.pick.findFirst({ where: { draftId: draft.id } });
    expect(persisted?.wasAutopick).toBe(true);
  });

  it("processes an expired draft and persists the Pick even with zero connected clients", async () => {
    const { league, draft } = await startFullDraft({ teamCount: 4 });
    await expireDraftNow(draft.id);
    await prisma.playerAdp.create({
      data: {
        playerId: (await createTestPlayer()).id,
        format: league.scoringFormat,
        adp: 1,
        source: "test",
      },
    });

    // Deliberately no connectClient/joinDraft call anywhere for this league.
    await runSweepOnce(handle.io);

    const pickCount = await prisma.pick.count({ where: { draftId: draft.id } });
    expect(pickCount).toBe(1);
  });

  it("broadcasts authoritative state to a joined client after a real autopick", async () => {
    const { league, draft, owner } = await startFullDraft({ teamCount: 4 });
    await expireDraftNow(draft.id);
    await prisma.playerAdp.create({
      data: {
        playerId: (await createTestPlayer()).id,
        format: league.scoringFormat,
        adp: 1,
        source: "test",
      },
    });

    const ticket = await createSocketTicket(owner.id);
    const socket = await connectClient(baseUrl, ticket.token);
    await joinDraft(socket, { leagueId: league.id });

    const statePromise = new Promise<DraftStateResult>((resolve) => {
      socket.once("draft:state", resolve);
    });

    await runSweepOnce(handle.io);

    const state = await statePromise;
    expect(state.draft?.currentPickNumber).toBe(2);
    expect(state.picks).toHaveLength(1);
    expect(state.picks[0]?.wasAutopick).toBe(true);

    socket.disconnect();
  });

  it("does not broadcast for a stale/no-op sweep pass", async () => {
    const { league, draft } = await startFullDraft({ teamCount: 4 });
    // Deliberately NOT expired — this is the no-op path.

    const ticket = await createSocketTicket(draft.currentUserId!);
    const socket = await connectClient(baseUrl, ticket.token);
    await joinDraft(socket, { leagueId: league.id });

    let broadcastReceived = false;
    socket.once("draft:state", () => {
      broadcastReceived = true;
    });

    await runSweepOnce(handle.io);
    // Give any (incorrect) broadcast a moment to arrive before asserting
    // none did.
    await new Promise((resolve) => setTimeout(resolve, 100));

    expect(broadcastReceived).toBe(false);

    socket.disconnect();
  });

  it("processing two leagues' expired turns in one sweep pass affects only the actually-expired one", async () => {
    const { league: expiredLeague, draft: expiredDraft } = await startFullDraft({ teamCount: 4 });
    await expireDraftNow(expiredDraft.id);
    await prisma.playerAdp.create({
      data: {
        playerId: (await createTestPlayer()).id,
        format: expiredLeague.scoringFormat,
        adp: 1,
        source: "test",
      },
    });
    const { draft: futureDraft } = await startFullDraft({ teamCount: 4 });

    await runSweepOnce(handle.io);

    expect(await prisma.pick.count({ where: { draftId: expiredDraft.id } })).toBe(1);
    expect(await prisma.pick.count({ where: { draftId: futureDraft.id } })).toBe(0);
  });
});

describe("startTurnSweep / stopTurnSweep", () => {
  beforeEach(async () => {
    await cleanupLeagueTestData();
  });

  afterEach(async () => {
    stopTurnSweep();
    await cleanupLeagueTestData();
  });

  it("autonomously processes an expired draft on its own recurring schedule, then stops after stopTurnSweep()", async () => {
    const { league, draft } = await startFullDraft({ teamCount: 4 });
    await expireDraftNow(draft.id);
    await prisma.playerAdp.create({
      data: {
        playerId: (await createTestPlayer()).id,
        format: league.scoringFormat,
        adp: 1,
        source: "test",
      },
    });

    startTurnSweep(handle.io, { intervalMs: 50 });

    await new Promise((resolve) => setTimeout(resolve, 300));
    expect(await prisma.pick.count({ where: { draftId: draft.id } })).toBe(1);

    stopTurnSweep();
    const countAfterStop = await prisma.pick.count({ where: { draftId: draft.id } });

    // No further ticks should run after stopping, even though the draft has
    // long since advanced past pick 1 (nothing left to auto-pick without a
    // new expired turn) — this mainly proves stopTurnSweep() is safe to call
    // and leaves no dangling schedule; the scheduling loop itself is proven
    // above by the single processed pick appearing without a direct
    // runSweepOnce() call.
    await new Promise((resolve) => setTimeout(resolve, 200));
    expect(await prisma.pick.count({ where: { draftId: draft.id } })).toBe(countAfterStop);
  });
});
