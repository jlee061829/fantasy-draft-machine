import { describe, expect, it } from "vitest";
import { normalizeFfcPosition } from "./positions.js";

describe("normalizeFfcPosition", () => {
  it.each([
    ["PK", "K"],
    ["pk", "K"],
    ["DST", "DEF"],
    ["D/ST", "DEF"],
    ["DEF", "DEF"],
    ["QB", "QB"],
    ["RB", "RB"],
    ["WR", "WR"],
    ["TE", "TE"],
    [" k ", "K"],
  ])("maps FFC position %s to %s", (input, expected) => {
    expect(normalizeFfcPosition(input)).toBe(expected);
  });

  it("returns null for an unrecognized position instead of guessing", () => {
    expect(normalizeFfcPosition("LB")).toBeNull();
  });
});
