import { DraftType, ScoringFormat } from "@fdm/database";
import { z } from "zod";
import { INVITE_CODE_ALPHABET, INVITE_CODE_LENGTH } from "./invite-code";

// Current product rule (Milestone 4.5): drafts are a fixed 15 rounds and
// roster/draft length is not user-configurable. `rosterSize` itself remains
// a fully dynamic column read by the engine (submitPick, autopick, board
// derivation all use `league.rosterSize`, never this constant) — only the
// *input* boundary is fixed, so configurability can be restored later
// without any engine change.
export const PRODUCT_ROSTER_SIZE = 15;

// .strict() rejects any field the client sends beyond the ones listed here —
// including ownerId, userId, or draftSlot spoofing attempts — with a 400
// instead of silently discarding them. Those three values are always
// server-derived and never read from this schema's parsed output.
//
// rosterSize is deliberately NOT part of this schema (see PRODUCT_ROSTER_SIZE
// above): create-league.ts's service-level CreateLeagueInput still accepts an
// explicit rosterSize (used internally by tests that need non-15 fixtures
// for engine/board coverage), but the public HTTP contract parsed by this
// schema has no such field, so a client attempting to send one is rejected
// by .strict() exactly like an ownerId/userId spoofing attempt — the route
// handler is what supplies PRODUCT_ROSTER_SIZE for every real request.
export const createLeagueInputSchema = z.strictObject({
  name: z.string().trim().min(1).max(50),
  teamCount: z.number().int().min(4).max(20).default(12),
  timerSeconds: z.number().int().min(10).max(300).default(60),
  scoringFormat: z.enum(ScoringFormat),
  draftType: z.enum(DraftType),
});

export type CreateLeagueApiInput = z.infer<typeof createLeagueInputSchema>;

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
//
// rosterSize has no field here (Milestone 4.5, see PRODUCT_ROSTER_SIZE
// above): the product rule is that draft length is fixed, so there is no
// settings mutation that can change it. update-league-settings.ts's write
// branch was updated in lockstep — it no longer has a rosterSize case to
// write, since UpdateLeagueSettingsInput (inferred from this schema) no
// longer has the field.
export const updateLeagueSettingsInputSchema = z
  .strictObject({
    name: z.string().trim().min(1).max(50).optional(),
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
