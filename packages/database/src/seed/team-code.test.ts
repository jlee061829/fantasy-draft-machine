import { describe, expect, it } from "vitest";
import { normalizeTeamCode } from "./team-code.js";

describe("normalizeTeamCode", () => {
  it("uppercases and trims", () => {
    expect(normalizeTeamCode(" kc ")).toBe("KC");
  });

  it.each([
    ["JAC", "JAX"],
    ["jac", "JAX"],
    ["WSH", "WAS"],
    ["wsh", "WAS"],
  ])("aliases %s to %s", (input, expected) => {
    expect(normalizeTeamCode(input)).toBe(expected);
  });

  it("leaves already-canonical codes unchanged", () => {
    expect(normalizeTeamCode("SF")).toBe("SF");
    expect(normalizeTeamCode("DEN")).toBe("DEN");
  });
});
