import { DraftType, ScoringFormat } from "@fdm/database";
import { z } from "zod";
import { INVITE_CODE_ALPHABET, INVITE_CODE_LENGTH } from "./invite-code";

// .strict() rejects any field the client sends beyond the ones listed here —
// including ownerId, userId, or draftSlot spoofing attempts — with a 400
// instead of silently discarding them. Those three values are always
// server-derived and never read from this schema's parsed output.
export const createLeagueInputSchema = z.strictObject({
  name: z.string().trim().min(1).max(50),
  rosterSize: z.number().int().min(8).max(25).default(16),
  teamCount: z.number().int().min(4).max(20).default(12),
  timerSeconds: z.number().int().min(10).max(300).default(60),
  scoringFormat: z.enum(ScoringFormat),
  draftType: z.enum(DraftType),
});

export type CreateLeagueInput = z.infer<typeof createLeagueInputSchema>;

// The regex is the exact settled invite-code alphabet (excludes 0/O and
// 1/I/L), not a generic [A-Z0-9]+ — a code containing an excluded character
// is malformed input (400), not a well-formed-but-unknown code (404).
const inviteCodePattern = new RegExp(`^[${INVITE_CODE_ALPHABET}]{${INVITE_CODE_LENGTH}}$`);

export const joinLeagueInputSchema = z.strictObject({
  inviteCode: z
    .string()
    .trim()
    .toUpperCase()
    .regex(inviteCodePattern, "Invalid invite code"),
});

export type JoinLeagueInput = z.infer<typeof joinLeagueInputSchema>;
