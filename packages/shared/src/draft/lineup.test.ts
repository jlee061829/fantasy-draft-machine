import { describe, expect, it } from "vitest";
import {
  canFieldStartingLineup,
  getMissingStartingLineupSlots,
  STARTING_LINEUP_TOTAL,
  wouldSelectionPreserveLineupFeasibility,
} from "./lineup.js";

describe("STARTING_LINEUP_TOTAL", () => {
  it("is 9 (1 QB + 2 RB + 2 WR + 1 TE + 1 FLEX + 1 K + 1 DEF)", () => {
    expect(STARTING_LINEUP_TOTAL).toBe(9);
  });
});

describe("getMissingStartingLineupSlots / canFieldStartingLineup", () => {
  it("a complete roster (RB fills FLEX) has nothing missing", () => {
    const missing = getMissingStartingLineupSlots({ QB: 1, RB: 3, WR: 2, TE: 1, K: 1, DEF: 1 });
    expect(missing.total).toBe(0);
    expect(canFieldStartingLineup({ QB: 1, RB: 3, WR: 2, TE: 1, K: 1, DEF: 1 })).toBe(true);
  });

  it("WR fills FLEX", () => {
    expect(canFieldStartingLineup({ QB: 1, RB: 2, WR: 3, TE: 1, K: 1, DEF: 1 })).toBe(true);
  });

  it("TE fills FLEX", () => {
    expect(canFieldStartingLineup({ QB: 1, RB: 2, WR: 2, TE: 2, K: 1, DEF: 1 })).toBe(true);
  });

  it("missing FLEX: exactly the six fixed starters, no surplus RB/WR/TE", () => {
    const missing = getMissingStartingLineupSlots({ QB: 1, RB: 2, WR: 2, TE: 1, K: 1, DEF: 1 });
    expect(missing.FLEX).toBe(1);
    expect(missing.total).toBe(1);
    expect(canFieldStartingLineup({ QB: 1, RB: 2, WR: 2, TE: 1, K: 1, DEF: 1 })).toBe(false);
  });

  it("missing QB alone (the 'Not allowed' worked example) is incomplete despite everything else present", () => {
    expect(canFieldStartingLineup({ QB: 0, RB: 7, WR: 5, TE: 1, K: 1, DEF: 1 })).toBe(false);
  });

  it("a heavy-RB roster (Allowed example) is complete when FLEX is covered", () => {
    expect(canFieldStartingLineup({ QB: 1, RB: 6, WR: 3, TE: 1, K: 1, DEF: 1 })).toBe(true);
  });

  it("a heavy-WR/2-QB roster (Also allowed example) is complete when FLEX is covered", () => {
    expect(canFieldStartingLineup({ QB: 2, RB: 2, WR: 6, TE: 1, K: 1, DEF: 1 })).toBe(true);
  });

  it("extra positions beyond FLEX do not double-count toward missing slots", () => {
    // 5 RB: 2 fixed + 3 surplus, but only 1 FLEX slot exists — surplus
    // beyond what FLEX needs is simply bench, not additional lineup credit.
    const missing = getMissingStartingLineupSlots({ QB: 1, RB: 5, WR: 2, TE: 1, K: 1, DEF: 1 });
    expect(missing.total).toBe(0);
    expect(missing.FLEX).toBe(0);
  });

  it("an unrecognized position key is inert rather than affecting the calculation", () => {
    const missing = getMissingStartingLineupSlots({
      QB: 1, RB: 2, WR: 2, TE: 1, K: 1, DEF: 1, FOOBAR: 99,
    });
    expect(missing.FLEX).toBe(1); // FOOBAR never contributes FLEX surplus
    expect(missing.total).toBe(1);
  });

  it("an empty roster is missing everything, including FLEX", () => {
    const missing = getMissingStartingLineupSlots({});
    expect(missing).toEqual({ QB: 1, RB: 2, WR: 2, TE: 1, K: 1, DEF: 1, FLEX: 1, total: 9 });
  });
});

describe("wouldSelectionPreserveLineupFeasibility", () => {
  // Matches the base plan's worked example roster shape exactly (RB 5 / WR 4
  // / TE 1): FLEX is already satisfied by RB/WR surplus, so exactly three
  // slots (QB, K, DEF) are genuinely missing — not four, which a
  // minimum-only roster (RB 2 / WR 2, no surplus) would incorrectly also
  // count FLEX against.
  it("4 picks remain, missing QB/K/DEF (FLEX already covered by RB/WR surplus): RB is still feasible", () => {
    const counts = { RB: 5, WR: 4, TE: 1 };
    expect(wouldSelectionPreserveLineupFeasibility(counts, "RB", 4)).toBe(true);
  });

  it("3 picks remain, missing QB/K/DEF: RB is infeasible; QB/K/DEF remain feasible", () => {
    const counts = { RB: 5, WR: 4, TE: 1 };
    expect(wouldSelectionPreserveLineupFeasibility(counts, "RB", 3)).toBe(false);
    expect(wouldSelectionPreserveLineupFeasibility(counts, "QB", 3)).toBe(true);
    expect(wouldSelectionPreserveLineupFeasibility(counts, "K", 3)).toBe(true);
    expect(wouldSelectionPreserveLineupFeasibility(counts, "DEF", 3)).toBe(true);
  });

  it("2 picks remain, missing K/DEF: WR is infeasible; K/DEF remain feasible", () => {
    const counts = { QB: 1, RB: 5, WR: 4, TE: 1 }; // FLEX already covered; missing K, DEF = 2
    expect(wouldSelectionPreserveLineupFeasibility(counts, "WR", 2)).toBe(false);
    expect(wouldSelectionPreserveLineupFeasibility(counts, "K", 2)).toBe(true);
    expect(wouldSelectionPreserveLineupFeasibility(counts, "DEF", 2)).toBe(true);
  });

  it("recognizes the FLEX obligation as pressure even when every named position minimum is met", () => {
    // QB/RB/WR/TE/K/DEF minimums are all satisfied, but there's no surplus
    // for FLEX — 1 slot is still missing.
    const counts = { QB: 1, RB: 2, WR: 2, TE: 1, K: 1, DEF: 1 };
    // 1 pick remains: taking a K/DEF/QB (already at minimum, no surplus
    // toward FLEX) would leave the FLEX obligation unmet with 0 picks left.
    expect(wouldSelectionPreserveLineupFeasibility(counts, "K", 1)).toBe(false);
    // Taking an RB/WR/TE instead creates FLEX surplus, completing the lineup.
    expect(wouldSelectionPreserveLineupFeasibility(counts, "RB", 1)).toBe(true);
  });

  it("backup QB/TE selection must not consume a pick still needed for an unfilled starter", () => {
    // BOT owns 1 QB already; still missing TE. Only 1 pick remains.
    const counts = { QB: 1, RB: 2, WR: 2, K: 1, DEF: 1 }; // TE: 0, missing TE + FLEX = 2
    expect(wouldSelectionPreserveLineupFeasibility(counts, "QB", 1)).toBe(false);
    expect(wouldSelectionPreserveLineupFeasibility(counts, "TE", 1)).toBe(false); // only fills 1 of the 2 still missing
  });
});
