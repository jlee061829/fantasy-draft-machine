import type { DraftStateDraftType, DraftStateResult, DraftStatePick } from "@fdm/shared";
import { getPickerForPickNumber } from "@fdm/shared";

// Milestone 4.5: one shared board-geometry derivation reused by both the
// pre-draft page (a static DraftStateResult-shaped snapshot with
// draft: null, picks: []) and the live draft room (the real socket-updated
// DraftStateResult). Rounds/columns are always read from
// state.league.rosterSize/teamCount — never a literal 15 — so a historical
// league created before the current product's fixed-15-round rule (e.g.
// rosterSize: 16) still renders its own correct geometry. Reuses the exact
// same getPickerForPickNumber every other draft-order-aware code path
// (draft start, submitPick, autopick) already uses, so there is exactly one
// snake/linear implementation in the codebase.
export interface DraftBoardCell {
  pickNumber: number;
  draftSlot: number;
  round: number;
  pick: DraftStatePick | null;
  isCurrentPick: boolean;
}

export interface DraftBoard {
  rounds: number;
  slots: number;
  cells: DraftBoardCell[][]; // cells[round - 1][draftSlot - 1]
}

export function deriveDraftBoard(state: DraftStateResult): DraftBoard {
  const rounds = state.league.rosterSize;
  const slots = state.league.teamCount;

  const pickByNumber = new Map<number, DraftStatePick>();
  for (const pick of state.picks) {
    pickByNumber.set(pick.pickNumber, pick);
  }

  // Only ACTIVE has a meaningful "on the clock" cell — PENDING (no Draft)
  // has nothing to highlight, and COMPLETE has already cleared
  // currentUserId/turnDeadline (Milestone 3.2), so treating any non-ACTIVE
  // status as "nothing highlighted" needs no special-casing beyond this one
  // guard.
  const currentPickNumber =
    state.draft?.status === "ACTIVE" ? state.draft.currentPickNumber : null;

  const cells: DraftBoardCell[][] = [];
  for (let round = 1; round <= rounds; round++) {
    const row: DraftBoardCell[] = [];
    for (let pickNumber = (round - 1) * slots + 1; pickNumber <= round * slots; pickNumber++) {
      const draftSlot = getPickerForPickNumber(pickNumber, slots, state.league.draftType);
      row[draftSlot - 1] = {
        pickNumber,
        draftSlot,
        round,
        pick: pickByNumber.get(pickNumber) ?? null,
        isCurrentPick: pickNumber === currentPickNumber,
      };
    }
    cells.push(row);
  }

  return { rounds, slots, cells };
}

// Milestone 4.6: purely a display cue (a "→"/"←" marker next to a round's
// row label) — never consulted to compute pick order itself, which remains
// getPickerForPickNumber's job via deriveDraftBoard above. LINEAR never
// reverses; SNAKE reverses on every even human-facing round, matching
// getPickerForPickNumber's own odd/even round convention (see its own tests
// in packages/shared).
export function getRoundDirection(round: number, draftType: DraftStateDraftType): "→" | "←" {
  if (draftType === "LINEAR") return "→";
  return round % 2 === 1 ? "→" : "←";
}

// Milestone 4.6: the 1-indexed round a given overall pick number falls in.
// Shared by the board's round row labels and TeamRosterPanel's per-pick
// round context, so there is exactly one "which round is pick N in"
// calculation in the codebase.
export function getRoundForPick(pickNumber: number, teamCount: number): number {
  return Math.ceil(pickNumber / teamCount);
}
