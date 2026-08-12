import { z } from "zod";
import { SLEEPER_PLAYERS_URL } from "./config.js";
import {
  FANTASY_POSITIONS,
  sleeperPlayerSchema,
  type SleeperPlayer,
} from "./schemas/sleeper.js";

// The live endpoint returns an object keyed by player_id, mixing every roster
// position together. We only confirm it's an object keyed by string here —
// individual entries aren't validated until after the fantasy-position filter
// below, since most of the ~12k entries aren't fantasy-relevant and were
// never meant to satisfy sleeperPlayerSchema.
const sleeperRawResponseSchema = z.record(z.string(), z.unknown());

function isFantasyPositionEntry(
  value: unknown,
): value is { position: (typeof FANTASY_POSITIONS)[number] } {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  const position = (value as Record<string, unknown>).position;
  return (
    typeof position === "string" &&
    (FANTASY_POSITIONS as readonly string[]).includes(position)
  );
}

export async function fetchSleeperPlayers(): Promise<SleeperPlayer[]> {
  const response = await fetch(SLEEPER_PLAYERS_URL);
  if (!response.ok) {
    throw new Error(
      `Sleeper players request failed: ${response.status} ${response.statusText} (${SLEEPER_PLAYERS_URL})`,
    );
  }

  const rawJson: unknown = await response.json();
  const rawPlayers = sleeperRawResponseSchema.parse(rawJson);

  const fantasyRelevantRaw = Object.values(rawPlayers).filter(
    isFantasyPositionEntry,
  );

  return z.array(sleeperPlayerSchema).parse(fantasyRelevantRaw);
}
