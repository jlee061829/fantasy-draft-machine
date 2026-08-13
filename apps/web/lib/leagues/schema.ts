import { DraftType, ScoringFormat } from "@fdm/database";
import { z } from "zod";

// .strict() rejects any field the client sends beyond the ones listed here —
// including ownerId, userId, or draftSlot spoofing attempts — with a 400
// instead of silently discarding them. Those three values are always
// server-derived and never read from this schema's parsed output.
export const createLeagueInputSchema = z.strictObject({
  name: z.string().trim().min(1).max(50),
  rosterSize: z.number().int().min(8).max(25).default(16),
  timerSeconds: z.number().int().min(10).max(300).default(60),
  scoringFormat: z.enum(ScoringFormat),
  draftType: z.enum(DraftType),
});

export type CreateLeagueInput = z.infer<typeof createLeagueInputSchema>;
