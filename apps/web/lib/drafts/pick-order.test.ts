import { getPickerForPickNumber } from "@fdm/shared";
import { describe, expect, it } from "vitest";

describe("getPickerForPickNumber", () => {
  describe("SNAKE", () => {
    it("goes slot 1 -> numTeams across the first (odd) round", () => {
      expect(getPickerForPickNumber(1, 12, "SNAKE")).toBe(1);
      expect(getPickerForPickNumber(6, 12, "SNAKE")).toBe(6);
      expect(getPickerForPickNumber(12, 12, "SNAKE")).toBe(12);
    });

    it("reverses numTeams -> slot 1 across the second (even) round", () => {
      expect(getPickerForPickNumber(13, 12, "SNAKE")).toBe(12);
      expect(getPickerForPickNumber(18, 12, "SNAKE")).toBe(7);
      expect(getPickerForPickNumber(24, 12, "SNAKE")).toBe(1);
    });

    it("goes forward again across the third round", () => {
      expect(getPickerForPickNumber(25, 12, "SNAKE")).toBe(1);
      expect(getPickerForPickNumber(36, 12, "SNAKE")).toBe(12);
    });
  });

  describe("LINEAR", () => {
    it("always goes slot 1 -> numTeams regardless of round", () => {
      expect(getPickerForPickNumber(1, 12, "LINEAR")).toBe(1);
      expect(getPickerForPickNumber(12, 12, "LINEAR")).toBe(12);
      expect(getPickerForPickNumber(13, 12, "LINEAR")).toBe(1);
      expect(getPickerForPickNumber(24, 12, "LINEAR")).toBe(12);
      expect(getPickerForPickNumber(25, 12, "LINEAR")).toBe(1);
    });
  });

  describe("input contract", () => {
    it.each([0, -1, 1.5, Number.NaN])(
      "rejects a non-positive-integer pickNumber (%s)",
      (pickNumber) => {
        expect(() => getPickerForPickNumber(pickNumber, 12, "SNAKE")).toThrow(RangeError);
      },
    );

    it.each([0, -1, 2.5, Number.NaN])(
      "rejects a non-positive-integer numTeams (%s)",
      (numTeams) => {
        expect(() => getPickerForPickNumber(1, numTeams, "SNAKE")).toThrow(RangeError);
      },
    );

    it("rejects an unsupported draftType", () => {
      expect(() =>
        getPickerForPickNumber(1, 12, "ROUND_ROBIN" as unknown as "SNAKE"),
      ).toThrow(RangeError);
    });
  });
});
