import { describe, expect, it } from "vitest";
import { createLeagueInputSchema } from "./schema";

function validInput(overrides: Record<string, unknown> = {}) {
  return {
    name: "Test League",
    rosterSize: 16,
    timerSeconds: 60,
    scoringFormat: "PPR",
    draftType: "SNAKE",
    ...overrides,
  };
}

describe("createLeagueInputSchema", () => {
  it("accepts a valid, complete input", () => {
    expect(createLeagueInputSchema.safeParse(validInput()).success).toBe(true);
  });

  it("applies default rosterSize and timerSeconds when omitted", () => {
    const { name, scoringFormat, draftType } = validInput();
    const result = createLeagueInputSchema.safeParse({ name, scoringFormat, draftType });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.rosterSize).toBe(16);
      expect(result.data.timerSeconds).toBe(60);
    }
  });

  it.each(["", "   "])("rejects a blank name (%j)", (name) => {
    expect(createLeagueInputSchema.safeParse(validInput({ name })).success).toBe(false);
  });

  it("rejects a name over 50 characters", () => {
    expect(
      createLeagueInputSchema.safeParse(validInput({ name: "a".repeat(51) })).success,
    ).toBe(false);
  });

  it.each([7, 26, 0, -1, 1.5])("rejects out-of-range rosterSize %s", (rosterSize) => {
    expect(createLeagueInputSchema.safeParse(validInput({ rosterSize })).success).toBe(
      false,
    );
  });

  it.each([9, 301, 0, -1, 1.5])("rejects out-of-range timerSeconds %s", (timerSeconds) => {
    expect(
      createLeagueInputSchema.safeParse(validInput({ timerSeconds })).success,
    ).toBe(false);
  });

  it("rejects an invalid scoringFormat", () => {
    expect(
      createLeagueInputSchema.safeParse(validInput({ scoringFormat: "BOGUS" })).success,
    ).toBe(false);
  });

  it("rejects an invalid draftType", () => {
    expect(
      createLeagueInputSchema.safeParse(validInput({ draftType: "BOGUS" })).success,
    ).toBe(false);
  });

  it.each(["ownerId", "userId", "draftSlot"])(
    "rejects an otherwise-valid input containing an unexpected %s field",
    (field) => {
      const result = createLeagueInputSchema.safeParse(
        validInput({ [field]: "spoofed" }),
      );
      expect(result.success).toBe(false);
    },
  );
});
