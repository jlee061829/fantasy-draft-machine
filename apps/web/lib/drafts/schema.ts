import { z } from "zod";

// .strict() rejects any field beyond playerId — including userId, draftId,
// leagueId, pickNumber, draftSlot, wasAutopick, currentUserId, or
// turnDeadline spoofing attempts — with a 400 instead of silently
// discarding them. Every one of those is always server-derived.
export const submitPickInputSchema = z.strictObject({
  playerId: z.string().min(1),
});

export type SubmitPickInput = z.infer<typeof submitPickInputSchema>;
