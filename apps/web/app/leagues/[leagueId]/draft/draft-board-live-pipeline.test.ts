import { getDraftStateForLeague, processBotDraftTurn, submitPick } from "@fdm/database";
import { cleanupLeagueTestData, createTestPlayer, createTestUser } from "@fdm/database/test-support";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createLeague } from "../../../../lib/leagues/create-league";
import { fillOpenLeagueSlotsWithBots } from "../../../../lib/leagues/fill-bots";
import { startDraft } from "../../../../lib/drafts/start-draft";
import { deriveDraftBoard } from "./draft-board-helpers";

// Added while investigating a manually-reported "SNAKE renders like LINEAR"
// live-browser bug. The prior draft-board-helpers.test.ts coverage only
// proved deriveDraftBoard is correct given a hand-constructed
// DraftStateResult fixture — it never exercised the real production
// pipeline a live page/socket payload actually goes through: real Postgres
// rows -> getDraftStateForLeague's Prisma select + toDraftStateResult
// mapping (packages/database) -> deriveDraftBoard (apps/web). This test
// closes exactly that gap: it drives a real 6-team SNAKE mock draft through
// the real, unmodified Fill Bots / Start Draft / submitPick /
// processBotDraftTurn services, reads the resulting state through the exact
// same getDraftStateForLeague call the socket server's draft:join/
// draft:state and the live room's initial SSR both use, and asserts the
// resulting board placement — not a synthetic fixture.
//
// A real end-to-end reproduction during this investigation (a live
// socket.io-client against a freshly started dev server, and the actual
// server-rendered HTML of /leagues/[leagueId]/draft/room) already showed
// this pipeline to be correct; this test makes that same proof permanent
// and automated.
describe("draft board — real DB -> getDraftStateForLeague -> deriveDraftBoard pipeline (6-team SNAKE)", () => {
  beforeEach(async () => {
    await cleanupLeagueTestData();
  });

  afterEach(async () => {
    await cleanupLeagueTestData();
  });

  it("places picks 1-13 in the correct row/column through the real production DTO pipeline, not a hand-built fixture", async () => {
    const owner = await createTestUser();
    const { league } = await createLeague(
      {
        name: "Live Pipeline SNAKE Test League",
        rosterSize: 15,
        teamCount: 6,
        timerSeconds: 60,
        scoringFormat: "PPR",
        draftType: "SNAKE",
      },
      owner.id,
    );

    const fill = await fillOpenLeagueSlotsWithBots(league.id, owner.id);
    const bySlot = new Map(fill.members.map((m) => [m.draftSlot, m]));

    for (let i = 0; i < 20; i++) {
      await createTestPlayer({ fullName: `Pipeline Player ${i}`, nflTeam: "KC" });
    }

    await startDraft(league.id, owner.id);

    // Pick 1: the human's own turn (slot 1).
    const pick1Player = await createTestPlayer({ fullName: "Human Pick 1", nflTeam: "SF" });
    await submitPick(league.id, owner.id, pick1Player.id);

    // Drain picks 2-11 via the real, unmodified Phase 5.3 BOT service — that
    // is every BOT turn in round 1 (slots 2-6) and round 2 (slots 6-2);
    // pick 12 (round 2's last, slot 1) is the HUMAN's turn and is
    // deliberately left un-submitted so this test can also assert the
    // still-pending state.
    for (let i = 0; i < 10; i++) {
      const outcome = await processBotDraftTurn(league.id);
      expect(outcome.outcome).toBe("picked");
    }
    // The 11th call lands on pick 12, the HUMAN's turn — must be a no-op.
    const humanTurnAttempt = await processBotDraftTurn(league.id);
    expect(humanTurnAttempt.outcome).toBe("skipped");

    // Read state through the exact same function the socket server's
    // draft:join/draft:state and the live room's initial SSR both call.
    const state = await getDraftStateForLeague(league.id);
    expect(state).not.toBeNull();
    expect(state!.league.draftType).toBe("SNAKE");
    expect(state!.picks).toHaveLength(11); // picks 1-11; pick 12 (HUMAN) still pending

    const board = deriveDraftBoard(state!);

    // Round 1 (picks 1-6): ascending, columns fixed 1..6.
    expect(board.cells[0]!.map((c) => c.pickNumber)).toEqual([1, 2, 3, 4, 5, 6]);
    expect(board.cells[0]!.map((c) => c.draftSlot)).toEqual([1, 2, 3, 4, 5, 6]);
    expect(board.cells[0]!.map((c) => c.pick?.leagueMemberId)).toEqual([
      bySlot.get(1)!.membershipId,
      bySlot.get(2)!.membershipId,
      bySlot.get(3)!.membershipId,
      bySlot.get(4)!.membershipId,
      bySlot.get(5)!.membershipId,
      bySlot.get(6)!.membershipId,
    ]);

    // Round 2 (picks 7-12): reversed pick order, same fixed columns —
    // exactly the behavior the manual bug report said was missing live.
    // Column 1 (slot 1) still shows the pick-12 *label* (deriveDraftBoard
    // always labels a cell by its computed pickNumber regardless of
    // whether that pick has happened yet) but no completed pick, since
    // pick 12 is the still-pending HUMAN turn asserted below.
    expect(board.cells[1]!.map((c) => c.pickNumber)).toEqual([12, 11, 10, 9, 8, 7]);
    expect(board.cells[1]!.map((c) => c.draftSlot)).toEqual([1, 2, 3, 4, 5, 6]);
    expect(board.cells[1]![0]!.pick).toBeNull();
    expect(board.cells[1]!.slice(1).map((c) => c.pick?.leagueMemberId)).toEqual([
      bySlot.get(2)!.membershipId,
      bySlot.get(3)!.membershipId,
      bySlot.get(4)!.membershipId,
      bySlot.get(5)!.membershipId,
      bySlot.get(6)!.membershipId,
    ]);
    // Slot 6 (whichever BOT that is) legitimately owns both pick 6 (round 1
    // last) and pick 7 (round 2 first) — the expected back-to-back turn,
    // not a bug.
    expect(board.cells[0]![5]!.pick?.leagueMemberId).toBe(bySlot.get(6)!.membershipId);
    expect(board.cells[1]![5]!.pick?.leagueMemberId).toBe(bySlot.get(6)!.membershipId);

    // The still-pending pick 12 belongs to slot 1 — round 2's last picker,
    // read live from the real authoritative state, not asserted from a
    // fixture.
    expect(state!.draft!.currentPickNumber).toBe(12);
    expect(state!.draft!.currentMemberId).toBe(bySlot.get(1)!.membershipId);
    expect(board.cells[1]![0]!.isCurrentPick).toBe(true);
  });
});
