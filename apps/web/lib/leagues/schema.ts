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

// Every field is optional with no .default() — unlike createLeagueInputSchema,
// a default here would silently inject a value for a field the commissioner
// never asked to change, and the service would then overwrite good data with
// it. Bounds are the same settled bounds as creation. .strict() rejects
// unknown fields (including ownerId spoofing attempts) the same way creation
// does. The refine rejects an empty PATCH body outright rather than letting
// it through as a silent no-op 200.
export const updateLeagueSettingsInputSchema = z
  .strictObject({
    name: z.string().trim().min(1).max(50).optional(),
    rosterSize: z.number().int().min(8).max(25).optional(),
    teamCount: z.number().int().min(4).max(20).optional(),
    timerSeconds: z.number().int().min(10).max(300).optional(),
    scoringFormat: z.enum(ScoringFormat).optional(),
    draftType: z.enum(DraftType).optional(),
  })
  .refine((value) => Object.keys(value).length > 0, {
    message: "At least one field must be provided.",
  });

export type UpdateLeagueSettingsInput = z.infer<typeof updateLeagueSettingsInputSchema>;

// The client submits the desired FULL order as LeagueMember ids, not
// individual (memberId, draftSlot) patches — see reorder-league-members.ts
// for why. Duplicate ids are a pure request-shape problem so they're
// rejected here at the schema layer (400); whether the set matches the
// league's actual current membership is a DB-state-dependent check that
// belongs in the service layer (409).
export const reorderLeagueMembersInputSchema = z.strictObject({
  memberIds: z
    .array(z.string().min(1))
    .min(1)
    .refine((ids) => new Set(ids).size === ids.length, {
      message: "memberIds must not contain duplicates.",
    }),
});

export type ReorderLeagueMembersInput = z.infer<typeof reorderLeagueMembersInputSchema>;
