import { processBotDraftTurn, submitPick } from "@fdm/database";
import { cleanupLeagueTestData, createTestPlayer, createTestUser } from "@fdm/database/test-support";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { startDraft } from "../drafts/start-draft";
import { createLeague } from "./create-league";
import { fillOpenLeagueSlotsWithBots } from "./fill-bots";
import { reorderLeagueMembers } from "./reorder-league-members";

// Phase 5.4: proves the exact solo-mock-draft flow end to end at the service
// layer — create underfilled league -> Fill Bots -> existing startDraft ->
// existing (Phase 5.3) processBotDraftTurn — with no second draft-start
// path and no special BOT fixture construction (createTestBotMember is not
// used anywhere in this file). The BOT LeagueMember rows consumed here are
// exactly what a real commissioner would produce through the product UI.
describe("Fill Bots -> Start Draft -> BOT turn orchestration integration", () => {
  beforeEach(async () => {
    await cleanupLeagueTestData();
  });

  afterEach(async () => {
    await cleanupLeagueTestData();
  });

  it("lets the existing startDraft succeed once Fill Bots completes an underfilled league", async () => {
    const owner = await createTestUser();
    const { league, membership: ownerMembership } = await createLeague(
      {
        name: "Fill Bots Integration Test League",
        rosterSize: 15,
        teamCount: 6,
        timerSeconds: 60,
        scoringFormat: "PPR",
        draftType: "SNAKE",
      },
      owner.id,
    );

    const fillResult = await fillOpenLeagueSlotsWithBots(league.id, owner.id);
    expect(fillResult.botsCreated).toBe(5);
    expect(fillResult.members).toHaveLength(6);

    const { draft } = await startDraft(league.id, owner.id);

    expect(draft.status).toBe("ACTIVE");
    // 6-team SNAKE: slot 1 (the human owner, unaffected by Fill) picks first.
    expect(draft.currentMemberId).toBe(ownerMembership.id);
  });

  it("lets the existing processBotDraftTurn service pick for a Fill-Bots-created BOT with no special fixture construction", async () => {
    const owner = await createTestUser();
    const { league } = await createLeague(
      {
        name: "Fill Bots Integration Test League 2",
        rosterSize: 15,
        teamCount: 2,
        timerSeconds: 60,
        scoringFormat: "PPR",
        draftType: "LINEAR",
      },
      owner.id,
    );

    const fillResult = await fillOpenLeagueSlotsWithBots(league.id, owner.id);
    const bot = fillResult.members.find((m) => m.participantType === "BOT");
    expect(bot).toBeDefined();
    expect(bot?.name).toBe("CPU 1");

    await startDraft(league.id, owner.id);

    // Pick 1 -> slot 1 (the human owner). Submitting the human's own first
    // pick hands the turn to the bot at slot 2 with no manual pick ever
    // made on the bot's behalf.
    const humanPlayer = await createTestPlayer({ fullName: "Human Pick", nflTeam: "KC" });
    await createTestPlayer({ fullName: "Bot Pick", nflTeam: "SF" }); // eligible for the bot's own selection
    await submitPick(league.id, owner.id, humanPlayer.id);

    const outcome = await processBotDraftTurn(league.id);

    expect(outcome.outcome).toBe("picked");
    if (outcome.outcome === "picked") {
      expect(outcome.result.pick.leagueMemberId).toBe(bot?.membershipId);
      expect(outcome.result.pick.wasAutopick).toBe(false);
      expect(outcome.result.pick.pickNumber).toBe(2);
    }
  });
});

// Follow-up verification, requested separately: does filling a league with
// bots interfere with the commissioner's ability to use the ALREADY-EXISTING
// reorder feature to choose a draft position other than slot 1? Nothing here
// is new production logic — reorderLeagueMembers, startDraft, and
// processBotDraftTurn are all called completely unmodified. The only thing
// under test is that a BOT-filled, then reordered, membership list behaves
// exactly like any other membership list to those three existing services.
describe("Fill Bots -> reorder -> Start Draft (human chooses a non-1 draft slot)", () => {
  beforeEach(async () => {
    await cleanupLeagueTestData();
  });

  afterEach(async () => {
    await cleanupLeagueTestData();
  });

  it("LINEAR: after Fill Bots + reorder moves the HUMAN to slot 4, slot 1's BOT is on the clock first, and 3 BOT picks later the HUMAN is on the clock at pick 4", async () => {
    const owner = await createTestUser();
    const { league, membership: ownerMembership } = await createLeague(
      {
        name: "Reorder After Fill Test League (LINEAR)",
        rosterSize: 15,
        teamCount: 6,
        timerSeconds: 60,
        scoringFormat: "PPR",
        draftType: "LINEAR",
      },
      owner.id,
    );
    // A handful of rostered players so the 3 BOT picks below each have an
    // eligible, undrafted candidate.
    for (let i = 0; i < 6; i++) {
      await createTestPlayer({ fullName: `Reorder Pool Player ${i}`, nflTeam: "KC" });
    }

    const fillResult = await fillOpenLeagueSlotsWithBots(league.id, owner.id);
    expect(fillResult.botsCreated).toBe(5);
    expect(fillResult.members).toHaveLength(6); // league is full

    // Before reorder: slot 1 owner(HUMAN), slots 2-5 CPU1-4, slot 6 CPU5.
    const bots = fillResult.members.filter((m) => m.participantType === "BOT");
    const cpu1 = bots.find((b) => b.name === "CPU 1")!;
    const cpu2 = bots.find((b) => b.name === "CPU 2")!;
    const cpu3 = bots.find((b) => b.name === "CPU 3")!;
    const cpu4 = bots.find((b) => b.name === "CPU 4")!;
    const cpu5 = bots.find((b) => b.name === "CPU 5")!;

    // Reorder so the HUMAN owner moves from slot 1 to slot 4: CPU1/CPU2/CPU3
    // shift up into slots 1-3, the owner takes slot 4, CPU4/CPU5 keep slots
    // 5-6. This is the existing, unmodified full-order-replacement reorder
    // contract (memberIds submitted in desired slot order 1..N) — nothing
    // BOT-specific about it; a BOT LeagueMember id is just another
    // membershipId to this service.
    const desiredOrder = [cpu1.membershipId, cpu2.membershipId, cpu3.membershipId, ownerMembership.id, cpu4.membershipId, cpu5.membershipId];
    const reordered = await reorderLeagueMembers(league.id, { memberIds: desiredOrder }, owner.id);

    const bySlot = new Map(reordered.members.map((m) => [m.draftSlot, m]));
    expect(bySlot.get(1)?.membershipId).toBe(cpu1.membershipId);
    expect(bySlot.get(2)?.membershipId).toBe(cpu2.membershipId);
    expect(bySlot.get(3)?.membershipId).toBe(cpu3.membershipId);
    expect(bySlot.get(4)?.membershipId).toBe(ownerMembership.id);
    expect(bySlot.get(5)?.membershipId).toBe(cpu4.membershipId);
    expect(bySlot.get(6)?.membershipId).toBe(cpu5.membershipId);
    // displayName is untouched by the reorder — CPU 2 is still named "CPU 2"
    // even though it moved from slot 3 to slot 2. draftSlot, not the name,
    // is what changed; the name never claimed to be positional in the first
    // place (see fill-bots.ts's naming rationale).
    expect(bySlot.get(2)?.name).toBe("CPU 2");

    const { draft } = await startDraft(league.id, owner.id);
    expect(draft.status).toBe("ACTIVE");
    // The participant now occupying slot 1 (CPU 1) is on the clock first —
    // NOT automatically the owner, even though the owner created the league
    // and originally held slot 1.
    expect(draft.currentMemberId).toBe(cpu1.membershipId);
    expect(draft.currentMemberId).not.toBe(ownerMembership.id);

    // Process exactly the 3 BOT turns for slots 1-3 via the existing,
    // unmodified Phase 5.3 service — no special fixture construction.
    const outcome1 = await processBotDraftTurn(league.id);
    const outcome2 = await processBotDraftTurn(league.id);
    const outcome3 = await processBotDraftTurn(league.id);
    expect(outcome1.outcome).toBe("picked");
    expect(outcome2.outcome).toBe("picked");
    expect(outcome3.outcome).toBe("picked");
    if (outcome1.outcome === "picked") expect(outcome1.result.pick.leagueMemberId).toBe(cpu1.membershipId);
    if (outcome2.outcome === "picked") expect(outcome2.result.pick.leagueMemberId).toBe(cpu2.membershipId);
    if (outcome3.outcome !== "picked") throw new Error("expected outcome3 to be picked");
    expect(outcome3.result.pick.leagueMemberId).toBe(cpu3.membershipId);

    // The core assertion this test exists for: after the 3 BOT picks for
    // slots 1-3, it's pick 4 and the HUMAN owner (now at slot 4) is on the
    // clock — proving the reorder's new slot assignment, not the owner's
    // original slot 1 or their identity, is what startDraft/applyPick's
    // turn-order math actually follows.
    expect(outcome3.result.draft.currentPickNumber).toBe(4);
    expect(outcome3.result.draft.currentMemberId).toBe(ownerMembership.id);

    // A 4th call must be a no-op: it is now the HUMAN's turn, and
    // processBotDraftTurn only ever processes a BOT-current turn.
    const outcome4 = await processBotDraftTurn(league.id);
    expect(outcome4).toEqual({ outcome: "skipped", leagueId: league.id, reason: "NOT_BOT_TURN" });
  });

  // Cheap follow-up in the same describe block: does a reorder also survive
  // a SNAKE round boundary correctly? getPickerForPickNumber's SNAKE logic
  // is already extensively covered on its own (packages/shared) and in
  // combination with BOT turns (Milestone 5.3's bot-turn/sweep tests) — this
  // test isn't re-proving snake arithmetic, only that a *reordered* slot
  // assignment feeds into that unmodified arithmetic identically to an
  // unreordered one, including across the round-1/round-2 boundary where
  // snake actually differs from linear.
  it("SNAKE: the HUMAN moved to slot 4 comes back on the clock at the correct round-2 pick after the snake reversal", async () => {
    const owner = await createTestUser();
    const { league, membership: ownerMembership } = await createLeague(
      {
        name: "Reorder After Fill Test League (SNAKE)",
        rosterSize: 15,
        teamCount: 6,
        timerSeconds: 60,
        scoringFormat: "PPR",
        draftType: "SNAKE",
      },
      owner.id,
    );
    for (let i = 0; i < 10; i++) {
      await createTestPlayer({ fullName: `Snake Reorder Pool Player ${i}`, nflTeam: "KC" });
    }

    const fillResult = await fillOpenLeagueSlotsWithBots(league.id, owner.id);
    const bots = fillResult.members.filter((m) => m.participantType === "BOT");
    const cpu1 = bots.find((b) => b.name === "CPU 1")!;
    const cpu2 = bots.find((b) => b.name === "CPU 2")!;
    const cpu3 = bots.find((b) => b.name === "CPU 3")!;
    const cpu4 = bots.find((b) => b.name === "CPU 4")!;
    const cpu5 = bots.find((b) => b.name === "CPU 5")!;

    // Same reorder as the LINEAR test: owner moves from slot 1 to slot 4.
    await reorderLeagueMembers(
      league.id,
      { memberIds: [cpu1.membershipId, cpu2.membershipId, cpu3.membershipId, ownerMembership.id, cpu4.membershipId, cpu5.membershipId] },
      owner.id,
    );

    await startDraft(league.id, owner.id);

    // Round 1, picks 1-3: slots 1-3 (CPU1-3). Same as LINEAR round 1 — SNAKE
    // and LINEAR are identical for an odd (first) round.
    await processBotDraftTurn(league.id);
    await processBotDraftTurn(league.id);
    const pick3 = await processBotDraftTurn(league.id);
    if (pick3.outcome !== "picked") throw new Error("expected pick3 to be picked");
    expect(pick3.result.draft.currentPickNumber).toBe(4);
    expect(pick3.result.draft.currentMemberId).toBe(ownerMembership.id);

    // Pick 4: the HUMAN's own manual pick (slot 4), advancing to pick 5.
    const player = await createTestPlayer({ fullName: "Human Round 1 Pick", nflTeam: "SF" });
    const afterHumanPick = await submitPick(league.id, owner.id, player.id);
    expect(afterHumanPick.draft.currentPickNumber).toBe(5);

    // Picks 5-6: slots 5-6 (CPU4, CPU5) finish round 1.
    const pick5 = await processBotDraftTurn(league.id);
    const pick6 = await processBotDraftTurn(league.id);
    if (pick5.outcome !== "picked" || pick6.outcome !== "picked") {
      throw new Error("expected picks 5 and 6 to be picked");
    }
    expect(pick5.result.pick.leagueMemberId).toBe(cpu4.membershipId);
    expect(pick6.result.pick.leagueMemberId).toBe(cpu5.membershipId);

    // Round 2 reverses (SNAKE): picks 7-12 go slot 6, 5, 4, 3, 2, 1 — the
    // same participant (CPU5, slot 6) picks back-to-back at picks 6 and 7.
    // The HUMAN at slot 4 is therefore the 3rd pick of round 2, overall
    // pick 9 (7 -> slot6, 8 -> slot5, 9 -> slot4).
    const pick7 = await processBotDraftTurn(league.id); // slot 6 (CPU5) again
    const pick8 = await processBotDraftTurn(league.id); // slot 5 (CPU4) again
    if (pick7.outcome !== "picked" || pick8.outcome !== "picked") {
      throw new Error("expected picks 7 and 8 to be picked");
    }
    expect(pick7.result.pick.leagueMemberId).toBe(cpu5.membershipId);
    expect(pick8.result.pick.leagueMemberId).toBe(cpu4.membershipId);
    expect(pick8.result.draft.currentPickNumber).toBe(9);
    // The reorder holds across the round boundary: the HUMAN, not whichever
    // participant originally held slot 1, is on the clock at pick 9.
    expect(pick8.result.draft.currentMemberId).toBe(ownerMembership.id);

    // pick 9 must be a no-op for processBotDraftTurn — it's the HUMAN's turn.
    const pick9Attempt = await processBotDraftTurn(league.id);
    expect(pick9Attempt).toEqual({ outcome: "skipped", leagueId: league.id, reason: "NOT_BOT_TURN" });
  });
});
