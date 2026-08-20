import { describe, expect, it } from "vitest";
import { generateInviteCode, INVITE_CODE_ALPHABET, INVITE_CODE_LENGTH } from "./invite-code";

describe("generateInviteCode", () => {
  it("generates a code of the exact configured length", () => {
    expect(generateInviteCode()).toHaveLength(INVITE_CODE_LENGTH);
  });

  it("only uses characters from the settled alphabet", () => {
    const pattern = new RegExp(`^[${INVITE_CODE_ALPHABET}]+$`);
    for (let i = 0; i < 50; i++) {
      expect(generateInviteCode()).toMatch(pattern);
    }
  });

  it("is always uppercase", () => {
    const code = generateInviteCode();
    expect(code).toBe(code.toUpperCase());
  });

  it("does not contain excluded ambiguous characters", () => {
    for (let i = 0; i < 50; i++) {
      const code = generateInviteCode();
      expect(code).not.toMatch(/[01ILO]/);
    }
  });
});
