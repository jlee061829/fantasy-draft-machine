import { describe, expect, it } from "vitest";
import { getPositionAccentClass } from "./position-style";

describe("getPositionAccentClass", () => {
  const known: Array<[string, string]> = [
    ["QB", "fdm-pos-qb"],
    ["RB", "fdm-pos-rb"],
    ["WR", "fdm-pos-wr"],
    ["TE", "fdm-pos-te"],
    ["K", "fdm-pos-k"],
    ["DEF", "fdm-pos-def"],
  ];

  for (const [position, className] of known) {
    it(`maps ${position} to ${className}`, () => {
      expect(getPositionAccentClass(position)).toBe(className);
    });
  }

  it("falls back to a neutral class for an unrecognized position", () => {
    expect(getPositionAccentClass("IDP")).toBe("fdm-pos-neutral");
  });
});
