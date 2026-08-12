import { FANTASY_POSITIONS, type SleeperPlayer } from "./schemas/sleeper.js";

export type FantasyPosition = SleeperPlayer["position"];

const FFC_ALIASES: Record<string, FantasyPosition> = {
  PK: "K",
  DST: "DEF",
  "D/ST": "DEF",
};

// FFC uses its own position vocabulary (e.g. "PK" for kickers). This maps an
// FFC position string onto the fantasy position vocabulary Sleeper already
// uses, so both sides of a match can be compared directly. Returns null for
// an unrecognized position rather than throwing — an unexpected FFC entry
// should surface as one unmatched record, not abort the whole match pass.
export function normalizeFfcPosition(position: string): FantasyPosition | null {
  const upper = position.toUpperCase().trim();
  const aliased = FFC_ALIASES[upper] ?? upper;

  if (!(FANTASY_POSITIONS as readonly string[]).includes(aliased)) {
    return null;
  }

  return aliased as FantasyPosition;
}
