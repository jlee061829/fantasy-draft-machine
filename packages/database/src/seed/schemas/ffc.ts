import { z } from "zod";

// FFC uses its own position vocabulary (e.g. "PK" for kickers, vs Sleeper's
// "K") and its own defense naming convention (e.g. "Denver Defense", vs
// Sleeper's "Denver Broncos"). Reconciling those differences is matching
// logic for a later milestone, so position/name stay loose strings here.
export const ffcPlayerEntrySchema = z.object({
  name: z.string(),
  position: z.string(),
  team: z.string(),
  adp: z.number(),
});

export const ffcAdpResponseSchema = z.object({
  status: z.literal("Success"),
  meta: z.object({
    type: z.string(),
  }),
  players: z.array(ffcPlayerEntrySchema),
});

export type FfcPlayerEntry = z.infer<typeof ffcPlayerEntrySchema>;
export type FfcAdpResponse = z.infer<typeof ffcAdpResponseSchema>;
