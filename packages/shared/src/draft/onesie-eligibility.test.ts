import { describe, expect, it } from "vitest";
import { getBackupWindowStart, isBackupWindowOpen, isCandidateOnesieEligible } from "./onesie-eligibility.js";

const rosterSize15 = 15; // backupWindowStart = max(1, 15-5) = 10

function eligible(overrides: Partial<Parameters<typeof isCandidateOnesieEligible>[0]>) {
  return isCandidateOnesieEligible({
    position: "QB",
    ownedCounts: {},
    ownedQbPositionalRank: null,
    ownedTePositionalRank: null,
    roundNumber: 1,
    rosterSize: rosterSize15,
    ...overrides,
  });
}

describe("getBackupWindowStart / isBackupWindowOpen", () => {
  it("rosterSize=15 -> backupWindowStart=10 (rounds 1-9 closed, 10-15 open)", () => {
    expect(getBackupWindowStart(15)).toBe(10);
    for (let round = 1; round <= 9; round++) {
      expect(isBackupWindowOpen(round, 15), `round ${round}`).toBe(false);
    }
    for (let round = 10; round <= 15; round++) {
      expect(isBackupWindowOpen(round, 15), `round ${round}`).toBe(true);
    }
  });

  it("clamps to round 1 for a pathologically small rosterSize", () => {
    expect(getBackupWindowStart(3)).toBe(1);
  });
});

describe("K/DEF hard caps", () => {
  it("K: owned 0 is eligible, owned 1 forbids all further K candidates", () => {
    expect(eligible({ position: "K", ownedCounts: { K: 0 } })).toBe(true);
    expect(eligible({ position: "K", ownedCounts: { K: 1 } })).toBe(false);
  });

  it("DEF: owned 0 is eligible, owned 1 forbids all further DEF candidates", () => {
    expect(eligible({ position: "DEF", ownedCounts: { DEF: 0 } })).toBe(true);
    expect(eligible({ position: "DEF", ownedCounts: { DEF: 1 } })).toBe(false);
  });
});

describe("QB eligibility", () => {
  it("owns 0 QB: always eligible", () => {
    expect(eligible({ position: "QB", ownedCounts: { QB: 0 }, roundNumber: 1 })).toBe(true);
  });

  it("elite QB1 (rank <= 8) forbids QB2 at any round", () => {
    expect(
      eligible({ position: "QB", ownedCounts: { QB: 1 }, ownedQbPositionalRank: 5, roundNumber: 12 }),
    ).toBe(false);
  });

  it("non-elite QB1, before the backup window: QB2 forbidden", () => {
    expect(
      eligible({ position: "QB", ownedCounts: { QB: 1 }, ownedQbPositionalRank: 10, roundNumber: 8 }),
    ).toBe(false);
  });

  it("non-elite QB1, backup window open: QB2 eligible", () => {
    expect(
      eligible({ position: "QB", ownedCounts: { QB: 1 }, ownedQbPositionalRank: 10, roundNumber: 10 }),
    ).toBe(true);
  });

  it("null-rank QB1 (no usable ADP), backup window open: QB2 eligible (treated as non-elite)", () => {
    expect(
      eligible({ position: "QB", ownedCounts: { QB: 1 }, ownedQbPositionalRank: null, roundNumber: 10 }),
    ).toBe(true);
  });

  it("null-rank QB1, before the backup window: QB2 forbidden", () => {
    expect(
      eligible({ position: "QB", ownedCounts: { QB: 1 }, ownedQbPositionalRank: null, roundNumber: 5 }),
    ).toBe(false);
  });

  it("owns 2 QB: QB3 always forbidden, regardless of round or rank", () => {
    expect(
      eligible({ position: "QB", ownedCounts: { QB: 2 }, ownedQbPositionalRank: 10, roundNumber: 15 }),
    ).toBe(false);
  });
});

describe("TE eligibility", () => {
  it("owns 0 TE: always eligible", () => {
    expect(eligible({ position: "TE", ownedCounts: { TE: 0 }, roundNumber: 1 })).toBe(true);
  });

  it("elite TE1 (rank <= 5) forbids TE2 at any round", () => {
    expect(
      eligible({ position: "TE", ownedCounts: { TE: 1 }, ownedTePositionalRank: 4, roundNumber: 15 }),
    ).toBe(false);
  });

  it("non-elite TE1, before the backup window: TE2 forbidden", () => {
    expect(
      eligible({ position: "TE", ownedCounts: { TE: 1 }, ownedTePositionalRank: 7, roundNumber: 8 }),
    ).toBe(false);
  });

  it("non-elite TE1, backup window open: TE2 eligible", () => {
    expect(
      eligible({ position: "TE", ownedCounts: { TE: 1 }, ownedTePositionalRank: 7, roundNumber: 10 }),
    ).toBe(true);
  });

  it("null-rank TE1, backup window open: TE2 eligible", () => {
    expect(
      eligible({ position: "TE", ownedCounts: { TE: 1 }, ownedTePositionalRank: null, roundNumber: 11 }),
    ).toBe(true);
  });

  it("owns 2 TE: TE3 always forbidden", () => {
    expect(
      eligible({ position: "TE", ownedCounts: { TE: 2 }, ownedTePositionalRank: 7, roundNumber: 15 }),
    ).toBe(false);
  });
});

describe("RB/WR and unrecognized positions", () => {
  it("RB/WR are never restricted by onesie rules", () => {
    expect(eligible({ position: "RB", ownedCounts: { RB: 10 } })).toBe(true);
    expect(eligible({ position: "WR", ownedCounts: { WR: 10 } })).toBe(true);
  });

  it("an unrecognized position is inert (eligible)", () => {
    expect(eligible({ position: "FOOBAR", ownedCounts: {} })).toBe(true);
  });
});
