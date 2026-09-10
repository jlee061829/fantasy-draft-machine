import type { DraftStateResult, DraftStatePick } from "@fdm/shared";
import { describe, expect, it } from "vitest";
import { deriveDraftBoard, getRoundDirection, getRoundForPick } from "./draft-board-helpers";

// Pure-function unit tests, no Postgres/DOM: these exercise only the board
// geometry/overlay logic built on top of an already-authoritative (or, for
// the pre-draft case, statically constructed) DraftStateResult. Turn-order
// correctness itself is getPickerForPickNumber's own concern, already
// covered in packages/shared — not re-derived or re-verified here, only
// reused.

function league(overrides: Partial<DraftStateResult["league"]> = {}): DraftStateResult["league"] {
  return {
    id: "league-1",
    name: "Test League",
    rosterSize: 15,
    teamCount: 4,
    scoringFormat: "PPR",
    draftType: "SNAKE",
    timerSeconds: 60,
    ...overrides,
  };
}

function members(count: number): DraftStateResult["members"] {
  return Array.from({ length: count }, (_, i) => ({
    membershipId: `m${i + 1}`,
    participantType: "HUMAN" as const,
    userId: `user-${i + 1}`,
    name: `Manager ${i + 1}`,
    image: null,
    draftSlot: i + 1,
  }));
}

function pick(
  pickNumber: number,
  leagueMemberId: string,
  overrides: Partial<DraftStatePick> = {},
): DraftStatePick {
  return {
    pickNumber,
    leagueMemberId,
    playerId: `player-${pickNumber}`,
    playerName: `Player ${pickNumber}`,
    playerPosition: "RB",
    playerNflTeam: "CIN",
    wasAutopick: false,
    createdAt: new Date(0).toISOString(),
    ...overrides,
  };
}

function state(overrides: Partial<DraftStateResult> = {}): DraftStateResult {
  return {
    league: league(),
    members: members(4),
    draft: null,
    picks: [],
    ...overrides,
  };
}

describe("deriveDraftBoard", () => {
  it("derives round/slot geometry from state.league.rosterSize/teamCount, not a hardcoded value", () => {
    const board = deriveDraftBoard(state({ league: league({ rosterSize: 15, teamCount: 12 }) }));
    expect(board.rounds).toBe(15);
    expect(board.slots).toBe(12);
    expect(board.cells).toHaveLength(15);
    expect(board.cells[0]).toHaveLength(12);
  });

  it("still uses a historical league's own non-15 rosterSize", () => {
    const board = deriveDraftBoard(state({ league: league({ rosterSize: 16, teamCount: 10 }) }));
    expect(board.rounds).toBe(16);
    expect(board.slots).toBe(10);
  });

  it("maps LINEAR pick numbers 1..N straight across every round", () => {
    const board = deriveDraftBoard(
      state({ league: league({ rosterSize: 2, teamCount: 3, draftType: "LINEAR" }) }),
    );
    expect(board.cells[0]!.map((c) => c.pickNumber)).toEqual([1, 2, 3]);
    expect(board.cells[1]!.map((c) => c.pickNumber)).toEqual([4, 5, 6]);
  });

  it("reverses SNAKE pick numbers at the round boundary while columns stay fixed", () => {
    const board = deriveDraftBoard(
      state({ league: league({ rosterSize: 3, teamCount: 3, draftType: "SNAKE" }) }),
    );
    // Round 1: slot 1 gets pick 1, slot 2 gets pick 2, slot 3 gets pick 3.
    expect(board.cells[0]!.map((c) => c.pickNumber)).toEqual([1, 2, 3]);
    // Round 2 (snake reversal): slot 1 gets pick 6, slot 2 gets pick 5, slot 3 gets pick 4.
    expect(board.cells[1]!.map((c) => c.pickNumber)).toEqual([6, 5, 4]);
    // Round 3: back to 1..N.
    expect(board.cells[2]!.map((c) => c.pickNumber)).toEqual([7, 8, 9]);
    // Column identity (draftSlot) never reverses, only which pick lands there.
    for (const row of board.cells) {
      expect(row.map((c) => c.draftSlot)).toEqual([1, 2, 3]);
    }
  });

  it("renders every cell empty for a pre-draft (no Draft yet) state", () => {
    const board = deriveDraftBoard(state({ league: league({ rosterSize: 2, teamCount: 2 }) }));
    for (const row of board.cells) {
      for (const cell of row) {
        expect(cell.pick).toBeNull();
        expect(cell.isCurrentPick).toBe(false);
      }
    }
  });

  it("populates completed cells from state.picks by pickNumber, leaving future cells empty", () => {
    const board = deriveDraftBoard(
      state({
        league: league({ rosterSize: 2, teamCount: 3, draftType: "SNAKE" }),
        draft: {
          id: "d1",
          status: "ACTIVE",
          currentPickNumber: 3,
          currentMemberId: "m3",
          turnDeadline: new Date(1000).toISOString(),
        },
        picks: [pick(1, "user-1"), pick(2, "user-2")],
      }),
    );
    expect(board.cells[0]![0]!.pick?.playerName).toBe("Player 1");
    expect(board.cells[0]![1]!.pick?.playerName).toBe("Player 2");
    expect(board.cells[0]![2]!.pick).toBeNull();
    expect(board.cells[1]!.every((c) => c.pick === null)).toBe(true);
  });

  it("highlights only the cell matching currentPickNumber while ACTIVE", () => {
    const board = deriveDraftBoard(
      state({
        league: league({ rosterSize: 2, teamCount: 3, draftType: "LINEAR" }),
        draft: {
          id: "d1",
          status: "ACTIVE",
          currentPickNumber: 3,
          currentMemberId: "m3",
          turnDeadline: new Date(1000).toISOString(),
        },
        picks: [pick(1, "user-1"), pick(2, "user-2")],
      }),
    );
    const flagged = board.cells.flat().filter((c) => c.isCurrentPick);
    expect(flagged).toHaveLength(1);
    expect(flagged[0]?.pickNumber).toBe(3);
  });

  it("highlights nothing once the Draft is COMPLETE", () => {
    const board = deriveDraftBoard(
      state({
        league: league({ rosterSize: 1, teamCount: 2, draftType: "LINEAR" }),
        draft: {
          id: "d1",
          status: "COMPLETE",
          currentPickNumber: 2,
          currentMemberId: null,
          turnDeadline: null,
        },
        picks: [pick(1, "user-1"), pick(2, "user-2")],
      }),
    );
    expect(board.cells.flat().some((c) => c.isCurrentPick)).toBe(false);
    expect(board.cells.flat().every((c) => c.pick !== null)).toBe(true);
  });

  it("carries the autopick marker through to the cell", () => {
    const board = deriveDraftBoard(
      state({
        league: league({ rosterSize: 1, teamCount: 1 }),
        picks: [pick(1, "user-1", { wasAutopick: true })],
      }),
    );
    expect(board.cells[0]![0]!.pick?.wasAutopick).toBe(true);
  });
});

// Regression coverage added while investigating a manually-reported "snake
// isn't reversing" mock-draft bug (a BOT-filled 6-team SNAKE league). Real
// end-to-end reproduction (fillOpenLeagueSlotsWithBots -> startDraft ->
// submitPick/processBotDraftTurn against real Postgres) found the backend
// Pick/currentMemberId sequence and this exact deriveDraftBoard placement
// both already correct for every one of picks 1-13 — see the investigation
// report for the full trace. What was genuinely missing, and is added here,
// is a test that (a) uses realistic HUMAN + stable-ordinal-named BOT
// members, the way Milestone 5.4's Fill Bots actually produces them, rather
// than generic "Manager N" fixtures, and (b) asserts exact row+column
// placement across three full rounds at the actual 6-team size manually
// tested, not just a 3-team toy example. Neither existing test did both of
// these together, which is exactly the gap a naming-flavored misreading of
// correct behavior could slip through.
describe("deriveDraftBoard — 6-team SNAKE mock-draft round-boundary regression", () => {
  // Mirrors fill-bots.ts's actual naming/slot convention: the HUMAN
  // commissioner keeps slot 1 (unreordered), bots fill the remaining slots
  // in ascending order with stable ordinals that are NOT derived from
  // draftSlot (CPU 5 legitimately ends up at the last slot here purely
  // because it was the fifth bot created for the fifth-remaining slot).
  const mockDraftMembers: DraftStateResult["members"] = [
    { membershipId: "human-1", participantType: "HUMAN", userId: "user-1", name: "Commissioner", image: null, draftSlot: 1 },
    { membershipId: "cpu-1", participantType: "BOT", userId: null, name: "CPU 1", image: null, draftSlot: 2 },
    { membershipId: "cpu-2", participantType: "BOT", userId: null, name: "CPU 2", image: null, draftSlot: 3 },
    { membershipId: "cpu-3", participantType: "BOT", userId: null, name: "CPU 3", image: null, draftSlot: 4 },
    { membershipId: "cpu-4", participantType: "BOT", userId: null, name: "CPU 4", image: null, draftSlot: 5 },
    { membershipId: "cpu-5", participantType: "BOT", userId: null, name: "CPU 5", image: null, draftSlot: 6 },
  ];

  // pickNumber -> the membershipId that authoritatively owns it, per the
  // exact 6-team SNAKE mapping given in the bug report:
  //   round 1 (picks 1-6):   slots 1,2,3,4,5,6
  //   round 2 (picks 7-12):  slots 6,5,4,3,2,1  (reversed; pick 6 and pick 7
  //                          both legitimately belong to slot 6 — the
  //                          expected "back-to-back at the turn" case, NOT
  //                          the reported bug)
  //   round 3 (picks 13-...): slots 1,2,3,...   again (pick 12 and pick 13
  //                          both belong to slot 1, the same phenomenon)
  const pickOwner: Record<number, string> = {
    1: "human-1",
    2: "cpu-1",
    3: "cpu-2",
    4: "cpu-3",
    5: "cpu-4",
    6: "cpu-5",
    7: "cpu-5",
    8: "cpu-4",
    9: "cpu-3",
    10: "cpu-2",
    11: "cpu-1",
    12: "human-1",
    13: "human-1",
  };

  function mockDraftPicks(): DraftStatePick[] {
    return Object.entries(pickOwner).map(([pickNumber, leagueMemberId]) =>
      pick(Number(pickNumber), leagueMemberId),
    );
  }

  function mockDraftState(): DraftStateResult {
    return {
      league: league({ rosterSize: 15, teamCount: 6, draftType: "SNAKE" }),
      members: mockDraftMembers,
      draft: {
        id: "d1",
        status: "ACTIVE",
        currentPickNumber: 14,
        currentMemberId: "cpu-1",
        turnDeadline: new Date(1000).toISOString(),
      },
      picks: mockDraftPicks(),
    };
  }

  it("places round 1 left-to-right, columns = fixed draft slots 1..6", () => {
    const board = deriveDraftBoard(mockDraftState());
    const round1 = board.cells[0]!;
    expect(round1.map((c) => c.pickNumber)).toEqual([1, 2, 3, 4, 5, 6]);
    expect(round1.map((c) => c.draftSlot)).toEqual([1, 2, 3, 4, 5, 6]);
    // Exact attribution, not just the pick-number label: column 2 (slot 2)
    // in round 1 is CPU 1's pick, not the human's and not any other bot's.
    expect(round1.map((c) => c.pick?.leagueMemberId)).toEqual([
      "human-1",
      "cpu-1",
      "cpu-2",
      "cpu-3",
      "cpu-4",
      "cpu-5",
    ]);
  });

  it("reverses PICK ORDER in round 2 while columns stay the same fixed 1..6 draft slots (this is the exact behavior the manual report said was missing)", () => {
    const board = deriveDraftBoard(mockDraftState());
    const round2 = board.cells[1]!;
    // Reading left to right (column/slot 1 -> 6), round 2's pick numbers
    // descend: col 1 = pick 12 (slot 1's LAST pick of the round), col 6 =
    // pick 7 (slot 6's FIRST pick of the round) — the reversal itself.
    expect(round2.map((c) => c.pickNumber)).toEqual([12, 11, 10, 9, 8, 7]);
    // Columns/draft slots themselves are NOT reversed — this is the
    // distinction the report called mandatory: the DOM/team headers never
    // flip, only which pick number lands in each fixed column.
    expect(round2.map((c) => c.draftSlot)).toEqual([1, 2, 3, 4, 5, 6]);
    // Exact attribution again: column 6 (slot 6, CPU 5) legitimately holds
    // BOTH round 1's last pick and round 2's first pick — verified directly
    // rather than merely asserting pick numbers.
    expect(round2.map((c) => c.pick?.leagueMemberId)).toEqual([
      "human-1",
      "cpu-1",
      "cpu-2",
      "cpu-3",
      "cpu-4",
      "cpu-5",
    ]);
  });

  it("returns to left-to-right pick order in round 3, with pick 13 landing back in column 1 (slot 1)", () => {
    const board = deriveDraftBoard(mockDraftState());
    const round3 = board.cells[2]!;
    expect(round3.map((c) => c.pickNumber)).toEqual([13, 14, 15, 16, 17, 18]);
    expect(round3.map((c) => c.draftSlot)).toEqual([1, 2, 3, 4, 5, 6]);
    // Only pick 13 has actually happened in this fixture; the rest of round
    // 3 is still empty (future picks), which is itself part of what proves
    // the placement is driven by getPickerForPickNumber, not by how many
    // Picks happen to already exist.
    expect(round3[0]!.pick?.leagueMemberId).toBe("human-1");
    expect(round3.slice(1).every((c) => c.pick === null)).toBe(true);
  });

  it("never lets a BOT's stable ordinal name influence where its picks are placed — draftSlot alone determines the column", () => {
    // CPU 1 sits at slot 2 in this fixture, not slot 1 and not slot 6 — its
    // name gives no hint about its position, and the board must never
    // place its picks anywhere but column 2 (index 1).
    const board = deriveDraftBoard(mockDraftState());
    for (const round of board.cells) {
      const cpu1Cell = round.find((c) => c.pick?.leagueMemberId === "cpu-1");
      if (cpu1Cell) {
        expect(cpu1Cell.draftSlot).toBe(2);
      }
    }
  });

  it("retains LINEAR behavior at the same 6-team size: round 2 continues 1..6 left-to-right with no reversal", () => {
    const linearPicks: DraftStatePick[] = Array.from({ length: 12 }, (_, i) =>
      pick(i + 1, mockDraftMembers[i % 6]!.membershipId),
    );
    const board = deriveDraftBoard({
      league: league({ rosterSize: 15, teamCount: 6, draftType: "LINEAR" }),
      members: mockDraftMembers,
      draft: null,
      picks: linearPicks,
    });
    const round2 = board.cells[1]!;
    expect(round2.map((c) => c.pickNumber)).toEqual([7, 8, 9, 10, 11, 12]);
    expect(round2.map((c) => c.draftSlot)).toEqual([1, 2, 3, 4, 5, 6]);
  });
});

describe("getRoundDirection", () => {
  it("is always left-to-right for LINEAR", () => {
    expect(getRoundDirection(1, "LINEAR")).toBe("→");
    expect(getRoundDirection(2, "LINEAR")).toBe("→");
    expect(getRoundDirection(7, "LINEAR")).toBe("→");
  });

  it("alternates for SNAKE, starting left-to-right on round 1", () => {
    expect(getRoundDirection(1, "SNAKE")).toBe("→");
    expect(getRoundDirection(2, "SNAKE")).toBe("←");
    expect(getRoundDirection(3, "SNAKE")).toBe("→");
    expect(getRoundDirection(4, "SNAKE")).toBe("←");
  });
});

describe("getRoundForPick", () => {
  it("returns round 1 for every pick in the first round", () => {
    expect(getRoundForPick(1, 12)).toBe(1);
    expect(getRoundForPick(12, 12)).toBe(1);
  });

  it("rolls over to the next round exactly at the boundary", () => {
    expect(getRoundForPick(13, 12)).toBe(2);
    expect(getRoundForPick(24, 12)).toBe(2);
    expect(getRoundForPick(25, 12)).toBe(3);
  });
});
