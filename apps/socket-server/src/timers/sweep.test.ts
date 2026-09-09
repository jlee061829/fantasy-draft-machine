import { createSocketTicket, prisma } from "@fdm/database";
import { cleanupLeagueTestData } from "@fdm/database/test-support";
import type { DraftStateResult } from "@fdm/shared";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { SocketServerHandle } from "../server.js";
import {
  connectClient,
  createTestBotMember,
  createTestLeague,
  createTestPlayer,
  createTestUser,
  expireDraftNow,
  joinDraft,
  startFullDraft,
  startFullDraftWithBotOnClock,
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
        playerId: (await createTestPlayer({ nflTeam: "KC" })).id,
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
        playerId: (await createTestPlayer({ nflTeam: "KC" })).id,
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
        playerId: (await createTestPlayer({ nflTeam: "KC" })).id,
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
        playerId: (await createTestPlayer({ nflTeam: "KC" })).id,
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
    const { league, owner } = await startFullDraft({ teamCount: 4 });
    // Deliberately NOT expired — this is the no-op path.

    const ticket = await createSocketTicket(owner.id);
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
        playerId: (await createTestPlayer({ nflTeam: "KC" })).id,
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

// Phase 5.3: the BOT-turn phase of runSweepOnce. No SocketTicket or client
// identity is ever created "as" a bot anywhere in this suite — bots are
// only ever discovered/processed server-side from authoritative Postgres
// state, exactly like the human phase already is.
describe("runSweepOnce — BOT turns", () => {
  beforeEach(async () => {
    await cleanupLeagueTestData();
  });

  afterEach(async () => {
    await cleanupLeagueTestData();
  });

  it("processes an ACTIVE draft with a BOT current participant, with zero connected clients, regardless of its (future) turnDeadline", async () => {
    const { league, draft } = await startFullDraftWithBotOnClock({ teamCount: 4 });
    await prisma.playerAdp.create({
      data: {
        playerId: (await createTestPlayer({ nflTeam: "KC" })).id,
        format: league.scoringFormat,
        adp: 1,
        source: "test",
      },
    });

    // Deliberately no connectClient/joinDraft call anywhere for this league,
    // and the draft's turnDeadline is still in the future (startFullDraftWithBotOnClock
    // defaults it to now + timerSeconds) — the BOT phase must not need it to
    // have expired.
    await runSweepOnce(handle.io);

    const pickCount = await prisma.pick.count({ where: { draftId: draft.id } });
    expect(pickCount).toBe(1);
    const persisted = await prisma.pick.findFirst({ where: { draftId: draft.id } });
    expect(persisted?.wasAutopick).toBe(false);
    expect(persisted?.leagueMemberId).toBe(draft.currentMemberId);
  });

  it("broadcasts authoritative state to a joined client after a real bot pick", async () => {
    const { league, membersBySlot, draft } = await startFullDraftWithBotOnClock({
      teamCount: 4,
    });
    await prisma.playerAdp.create({
      data: {
        playerId: (await createTestPlayer({ nflTeam: "KC" })).id,
        format: league.scoringFormat,
        adp: 1,
        source: "test",
      },
    });

    // Join as one of the HUMAN members (slot 2) to observe the broadcast —
    // bots never connect a socket themselves.
    const ticket = await createSocketTicket(membersBySlot[2]!);
    const socket = await connectClient(baseUrl, ticket.token);
    await joinDraft(socket, { leagueId: league.id });

    const statePromise = new Promise<DraftStateResult>((resolve) => {
      socket.once("draft:state", resolve);
    });

    await runSweepOnce(handle.io);

    const state = await statePromise;
    expect(state.draft?.currentPickNumber).toBe(2);
    expect(state.picks).toHaveLength(1);
    expect(state.picks[0]?.leagueMemberId).toBe(draft.currentMemberId);
    expect(state.picks[0]?.wasAutopick).toBe(false);

    socket.disconnect();
  });

  it("does not broadcast and leaves the Draft ACTIVE/unchanged when a BOT turn is exhausted", async () => {
    const { league, draft, membersBySlot } = await startFullDraftWithBotOnClock({ teamCount: 4 });
    // Deliberately no eligible rostered Player exists.

    const ticket = await createSocketTicket(membersBySlot[2]!);
    const socket = await connectClient(baseUrl, ticket.token);
    await joinDraft(socket, { leagueId: league.id });

    let broadcastReceived = false;
    socket.once("draft:state", () => {
      broadcastReceived = true;
    });

    await runSweepOnce(handle.io);
    await new Promise((resolve) => setTimeout(resolve, 100));

    expect(broadcastReceived).toBe(false);
    const persisted = await prisma.draft.findUnique({ where: { id: draft.id } });
    expect(persisted?.status).toBe("ACTIVE");
    expect(persisted?.currentMemberId).toBe(draft.currentMemberId);
    expect(await prisma.pick.count({ where: { draftId: draft.id } })).toBe(0);

    socket.disconnect();
  });

  it("discovers and processes a pre-existing BOT-current draft on the very first tick (restart-recovery shape)", async () => {
    const { league, draft } = await startFullDraftWithBotOnClock({ teamCount: 4 });
    await prisma.playerAdp.create({
      data: {
        playerId: (await createTestPlayer({ nflTeam: "KC" })).id,
        format: league.scoringFormat,
        adp: 1,
        source: "test",
      },
    });

    // No prior sweep tick has ever run against this draft — this simulates
    // a freshly-started process discovering a BOT already on the clock,
    // exactly as the equivalent human restart-recovery test does above.
    await runSweepOnce(handle.io);

    expect(await prisma.pick.count({ where: { draftId: draft.id } })).toBe(1);
  });

  it("a HUMAN-current draft is left entirely alone by the BOT phase", async () => {
    const { draft } = await startFullDraft({ teamCount: 4 });
    // Not expired, and current participant is HUMAN — neither sweep phase
    // should touch it.

    await runSweepOnce(handle.io);

    expect(await prisma.pick.count({ where: { draftId: draft.id } })).toBe(0);
  });

  it("processes a HUMAN's expired turn and, when it advances directly to a BOT, also processes that BOT's turn in the same runSweepOnce tick", async () => {
    // LINEAR so slot 1 (HUMAN) and slot 2 (BOT) alternate every pick:
    // pick 1 -> slot 1 (HUMAN, expired), pick 2 -> slot 2 (BOT). This
    // exercises the claim that runBotTurnSweep's own discovery query runs
    // (and sees committed state) strictly after runHumanExpirySweep fully
    // completes within one runSweepOnce call — not that either phase
    // reaches into the other's loop.
    const owner = await createTestUser();
    const league = await createTestLeague(owner.id, {
      teamCount: 2,
      rosterSize: 2,
      draftType: "LINEAR",
    });
    const humanMembership = await prisma.leagueMember.create({
      data: { leagueId: league.id, userId: owner.id, draftSlot: 1 },
    });
    await createTestBotMember(league.id, 2);
    const draft = await prisma.draft.create({
      data: {
        leagueId: league.id,
        status: "ACTIVE",
        currentPickNumber: 1,
        currentMemberId: humanMembership.id,
        turnDeadline: new Date(Date.now() - 1_000),
      },
    });
    await prisma.playerAdp.create({
      data: {
        playerId: (await createTestPlayer({ nflTeam: "KC", fullName: "First" })).id,
        format: league.scoringFormat,
        adp: 1,
        source: "test",
      },
    });
    await prisma.playerAdp.create({
      data: {
        playerId: (await createTestPlayer({ nflTeam: "KC", fullName: "Second" })).id,
        format: league.scoringFormat,
        adp: 2,
        source: "test",
      },
    });

    await runSweepOnce(handle.io);

    expect(await prisma.pick.count({ where: { draftId: draft.id } })).toBe(2);
    const persisted = await prisma.draft.findUnique({ where: { id: draft.id } });
    expect(persisted?.currentPickNumber).toBe(3);
    expect(persisted?.currentMemberId).toBe(humanMembership.id);
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
        playerId: (await createTestPlayer({ nflTeam: "KC" })).id,
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

  it("progresses a consecutive BOT->BOT->BOT chain one pick per tick, completing the draft", async () => {
    // A 3-team, 1-round, all-BOT draft: 3 total picks, none of which any
    // HUMAN ever makes. Phase 5.3's policy is deliberately at most one BOT
    // pick per league per sweep tick (no in-process draining loop), so this
    // asserts the chain fully resolves across several ticks rather than in
    // one — the intentional latency tradeoff documented in sweep.ts.
    const owner = await createTestUser();
    const league = await createTestLeague(owner.id, { teamCount: 3, rosterSize: 1 });
    const bot1 = await createTestBotMember(league.id, 1);
    await createTestBotMember(league.id, 2);
    await createTestBotMember(league.id, 3);
    const draft = await prisma.draft.create({
      data: {
        leagueId: league.id,
        status: "ACTIVE",
        currentPickNumber: 1,
        currentMemberId: bot1.id,
        turnDeadline: new Date(Date.now() + 60_000),
      },
    });
    for (const adp of [1, 2, 3]) {
      await prisma.playerAdp.create({
        data: {
          playerId: (await createTestPlayer({ nflTeam: "KC" })).id,
          format: league.scoringFormat,
          adp,
          source: "test",
        },
      });
    }

    startTurnSweep(handle.io, { intervalMs: 50 });

    await new Promise((resolve) => setTimeout(resolve, 500));
    stopTurnSweep();

    expect(await prisma.pick.count({ where: { draftId: draft.id } })).toBe(3);
    const persisted = await prisma.draft.findUnique({ where: { id: draft.id } });
    expect(persisted?.status).toBe("COMPLETE");
    expect(persisted?.currentMemberId).toBeNull();
  });
});
