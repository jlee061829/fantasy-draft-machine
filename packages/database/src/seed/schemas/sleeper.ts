import { z } from "zod";

// Sleeper labels team defenses with position "DEF" and omits full_name and
// search_rank for them entirely (only first_name/last_name are set, e.g.
// "Houston"/"Texans") — verified against the live payload, where both keys
// are absent (not null) on all 32 DEF entries and present on every other
// fantasy-relevant entry.
export const FANTASY_POSITIONS = ["QB", "RB", "WR", "TE", "K", "DEF"] as const;

// The live endpoint returns ~12k entries covering every roster position
// (LB, CB, OL, punters, etc.), not just fantasy-relevant ones. Filtering to
// FANTASY_POSITIONS happens before a raw entry reaches this schema — that
// filter is ingestion logic, not part of this schema's contract. This
// schema only describes a single entry already known to be fantasy-relevant.
export const sleeperPlayerSchema = z.object({
  player_id: z.string(),
  first_name: z.string(),
  last_name: z.string(),
  full_name: z.string().nullish(),
  position: z.enum(FANTASY_POSITIONS),
  team: z.string().nullable(),
  // Omitted (not null) on DEF entries — normalized to null so downstream
  // code only ever handles number | null, never undefined.
  search_rank: z.number().nullish().transform((v) => v ?? null),
  injury_status: z.string().nullable(),
});

export type SleeperPlayer = z.infer<typeof sleeperPlayerSchema>;
