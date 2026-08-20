import { randomInt } from "node:crypto";

// Excludes ambiguous characters (0/O, 1/I/L) so codes are easy to read and
// type back in correctly. Shared by generation here, the join-request Zod
// validator, and the invite-code migration backfill — all three must agree
// on the exact same alphabet.
export const INVITE_CODE_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
export const INVITE_CODE_LENGTH = 8;

export function generateInviteCode(): string {
  let code = "";
  for (let i = 0; i < INVITE_CODE_LENGTH; i++) {
    code += INVITE_CODE_ALPHABET[randomInt(INVITE_CODE_ALPHABET.length)];
  }
  return code;
}
