import { describe, expect, it } from "vitest";
import { normalizePlayerName } from "./normalize.js";

describe("normalizePlayerName", () => {
  it("lowercases", () => {
    expect(normalizePlayerName("Christian McCaffrey")).toBe(
      "christian mccaffrey",
    );
  });

  it.each([
    ["Brian Thomas Jr.", "brian thomas"],
    ["James Cook III", "james cook"],
    ["Aaron Jones Sr.", "aaron jones"],
    ["Patrick Mahomes IV", "patrick mahomes"],
  ])("strips the %s suffix", (input, expected) => {
    expect(normalizePlayerName(input)).toBe(expected);
  });

  it.each([
    ["A.J. Brown", "aj brown"],
    ["C.J. Stroud", "cj stroud"],
    ["J.K. Dobbins", "jk dobbins"],
  ])("strips periods from initials in %s", (input, expected) => {
    expect(normalizePlayerName(input)).toBe(expected);
  });

  it.each([
    ["Ja'Marr Chase", "jamarr chase"],
    ["D'Andre Swift", "dandre swift"],
  ])("strips straight apostrophes in %s", (input, expected) => {
    expect(normalizePlayerName(input)).toBe(expected);
  });

  it.each([
    ["Ja’Marr Chase", "jamarr chase"],
    ["D’Andre Swift", "dandre swift"],
  ])("strips curly apostrophes in %s the same as straight ones", (input, expected) => {
    expect(normalizePlayerName(input)).toBe(expected);
  });

  it.each([
    ["Ray-Ray McCloud", "rayray mccloud"],
    ["Amon-Ra St. Brown", "amonra st brown"],
  ])("fuses hyphenated names in %s", (input, expected) => {
    expect(normalizePlayerName(input)).toBe(expected);
  });

  it("collapses repeated internal whitespace and trims", () => {
    expect(normalizePlayerName("  Extra   Space Guy  ")).toBe(
      "extra space guy",
    );
  });

  it("combines an apostrophe and a suffix in the same name", () => {
    expect(normalizePlayerName("O'Dell Beckham Jr.")).toBe("odell beckham");
  });

  it("normalizes accented and unaccented forms of the same name to the same value", () => {
    expect(normalizePlayerName("Eddy Piñeiro")).toBe(
      normalizePlayerName("Eddy Pineiro"),
    );
  });

  it.each([
    ["Eddy Piñeiro", "eddy pineiro"],
    ["José Nuñez", "jose nunez"],
  ])("strips diacritics in %s", (input, expected) => {
    expect(normalizePlayerName(input)).toBe(expected);
  });
});
