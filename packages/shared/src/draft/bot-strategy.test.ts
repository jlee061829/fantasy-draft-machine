import { describe, expect, it } from "vitest";
import { BOT_STRATEGY_ROTATION, computeStrategyPositionPenalty } from "./bot-strategy.js";

describe("BOT_STRATEGY_ROTATION", () => {
  it("is the frozen 4-strategy deterministic order, no ZERO_RB", () => {
    expect(BOT_STRATEGY_ROTATION).toEqual(["BALANCED", "RB_HEAVY", "WR_HEAVY", "HERO_RB"]);
  });
});

describe("computeStrategyPositionPenalty — QB/TE/K/DEF are strategy-neutral", () => {
  const strategies = ["BALANCED", "RB_HEAVY", "WR_HEAVY", "HERO_RB"] as const;

  it("QB penalty (0/+0, 1/+18) is identical across every strategy", () => {
    for (const strategy of strategies) {
      expect(computeStrategyPositionPenalty(strategy, "QB", { QB: 0 }, false)).toBe(0);
      expect(computeStrategyPositionPenalty(strategy, "QB", { QB: 1 }, false)).toBe(18);
    }
  });

  it("TE penalty (0/+0, 1/+15) is identical across every strategy", () => {
    for (const strategy of strategies) {
      expect(computeStrategyPositionPenalty(strategy, "TE", { TE: 0 }, false)).toBe(0);
      expect(computeStrategyPositionPenalty(strategy, "TE", { TE: 1 }, false)).toBe(15);
    }
  });

  it("K/DEF penalty is timing-only (+100 outside, +0 inside the late window) and identical across strategies", () => {
    for (const strategy of strategies) {
      expect(computeStrategyPositionPenalty(strategy, "K", { K: 0 }, false)).toBe(100);
      expect(computeStrategyPositionPenalty(strategy, "K", { K: 0 }, true)).toBe(0);
      expect(computeStrategyPositionPenalty(strategy, "DEF", { DEF: 0 }, false)).toBe(100);
      expect(computeStrategyPositionPenalty(strategy, "DEF", { DEF: 0 }, true)).toBe(0);
    }
  });
});

describe("BALANCED RB/WR bands", () => {
  it("RB: 0-2/+0, 3/+5, 4+/+12", () => {
    expect(computeStrategyPositionPenalty("BALANCED", "RB", { RB: 2 }, false)).toBe(0);
    expect(computeStrategyPositionPenalty("BALANCED", "RB", { RB: 3 }, false)).toBe(5);
    expect(computeStrategyPositionPenalty("BALANCED", "RB", { RB: 4 }, false)).toBe(12);
  });
  it("WR: 0-3/+0, 4/+5, 5+/+12", () => {
    expect(computeStrategyPositionPenalty("BALANCED", "WR", { WR: 3 }, false)).toBe(0);
    expect(computeStrategyPositionPenalty("BALANCED", "WR", { WR: 4 }, false)).toBe(5);
    expect(computeStrategyPositionPenalty("BALANCED", "WR", { WR: 5 }, false)).toBe(12);
  });
});

describe("RB_HEAVY bands", () => {
  it("RB: 0-4/+0, 5/+5, 6+/+12 (later than BALANCED)", () => {
    expect(computeStrategyPositionPenalty("RB_HEAVY", "RB", { RB: 4 }, false)).toBe(0);
    expect(computeStrategyPositionPenalty("RB_HEAVY", "RB", { RB: 5 }, false)).toBe(5);
    expect(computeStrategyPositionPenalty("RB_HEAVY", "RB", { RB: 6 }, false)).toBe(12);
  });
  it("WR: 0-2/+0, 3/+5, 4+/+12 (earlier than BALANCED)", () => {
    expect(computeStrategyPositionPenalty("RB_HEAVY", "WR", { WR: 2 }, false)).toBe(0);
    expect(computeStrategyPositionPenalty("RB_HEAVY", "WR", { WR: 3 }, false)).toBe(5);
    expect(computeStrategyPositionPenalty("RB_HEAVY", "WR", { WR: 4 }, false)).toBe(12);
  });
});

describe("WR_HEAVY bands (mirror of RB_HEAVY)", () => {
  it("WR: 0-4/+0, 5/+5, 6+/+12", () => {
    expect(computeStrategyPositionPenalty("WR_HEAVY", "WR", { WR: 4 }, false)).toBe(0);
    expect(computeStrategyPositionPenalty("WR_HEAVY", "WR", { WR: 5 }, false)).toBe(5);
    expect(computeStrategyPositionPenalty("WR_HEAVY", "WR", { WR: 6 }, false)).toBe(12);
  });
  it("RB: 0-2/+0, 3/+5, 4+/+12", () => {
    expect(computeStrategyPositionPenalty("WR_HEAVY", "RB", { RB: 2 }, false)).toBe(0);
    expect(computeStrategyPositionPenalty("WR_HEAVY", "RB", { RB: 3 }, false)).toBe(5);
    expect(computeStrategyPositionPenalty("WR_HEAVY", "RB", { RB: 4 }, false)).toBe(12);
  });
});

describe("HERO_RB bands", () => {
  it("RB: 0 owned/+0, 1/+25, 2/+8, 3+/+12", () => {
    expect(computeStrategyPositionPenalty("HERO_RB", "RB", { RB: 0 }, false)).toBe(0);
    expect(computeStrategyPositionPenalty("HERO_RB", "RB", { RB: 1 }, false)).toBe(25);
    expect(computeStrategyPositionPenalty("HERO_RB", "RB", { RB: 2 }, false)).toBe(8);
    expect(computeStrategyPositionPenalty("HERO_RB", "RB", { RB: 3 }, false)).toBe(12);
  });
  it("WR: same as BALANCED", () => {
    expect(computeStrategyPositionPenalty("HERO_RB", "WR", { WR: 3 }, false)).toBe(0);
    expect(computeStrategyPositionPenalty("HERO_RB", "WR", { WR: 4 }, false)).toBe(5);
    expect(computeStrategyPositionPenalty("HERO_RB", "WR", { WR: 5 }, false)).toBe(12);
  });
});

describe("unrecognized position", () => {
  it("returns 0 for every strategy", () => {
    for (const strategy of ["BALANCED", "RB_HEAVY", "WR_HEAVY", "HERO_RB"] as const) {
      expect(computeStrategyPositionPenalty(strategy, "FOOBAR", {}, false)).toBe(0);
    }
  });
});
