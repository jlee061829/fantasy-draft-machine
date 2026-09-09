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
