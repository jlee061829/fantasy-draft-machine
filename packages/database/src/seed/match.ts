import { normalizeFfcPosition, type FantasyPosition } from "./positions.js";
import { normalizePlayerName } from "./normalize.js";
import type { FfcPlayerEntry } from "./schemas/ffc.js";
import type { SleeperPlayer } from "./schemas/sleeper.js";
import { normalizeTeamCode } from "./team-code.js";

export interface MatchedPlayer {
  sleeperPlayer: SleeperPlayer;
  ffcEntry: FfcPlayerEntry;
  matchMethod:
    | "name"
    | "def-team"
    | "name-team-tiebreak"
    | "name-position-tiebreak";
  // "unknown" when the Sleeper side's team is null — missing data is never
  // treated as a mismatch.
  teamComparison: "same" | "different" | "unknown";
}

export interface UnmatchedFfcEntry {
  ffcEntry: FfcPlayerEntry;
  reason: "no-candidates" | "unrecognized-position";
}

export interface AmbiguousFfcEntry {
  ffcEntry: FfcPlayerEntry;
  // Always the full candidate set, even when a tiebreaker narrowed it partway
  // before failing to reach a single result — a human reviewing this report
  // should see every real option, not an already-filtered subset.
  candidates: SleeperPlayer[];
  reason: "multiple-candidates";
}

export interface MatchResult {
  matched: MatchedPlayer[];
  unmatched: UnmatchedFfcEntry[];
  ambiguous: AmbiguousFfcEntry[];
}

function indexBy<T>(items: T[], key: (item: T) => string): Map<string, T[]> {
  const index = new Map<string, T[]>();
  for (const item of items) {
    const k = key(item);
    const existing = index.get(k);
    if (existing) {
      existing.push(item);
    } else {
      index.set(k, [item]);
    }
  }
  return index;
}

function teamComparisonFor(
  sleeperTeam: string | null,
  ffcTeam: string,
): MatchedPlayer["teamComparison"] {
  if (sleeperTeam === null) {
    return "unknown";
  }
  return normalizeTeamCode(sleeperTeam) === normalizeTeamCode(ffcTeam)
    ? "same"
    : "different";
}

type NameResolution =
  | {
      player: SleeperPlayer;
      matchMethod: "name" | "name-team-tiebreak" | "name-position-tiebreak";
    }
  | SleeperPlayer[]; // still ambiguous — the original, full candidate set

// Narrows a multi-candidate name match toward exactly one player using team,
// then position, as tiebreakers — never as a rejection filter. If a filter
// narrows to zero, that filter is discarded and the prior (non-empty)
// candidate set is kept, since team/position snapshots can be stale.
function resolveByName(
  candidates: SleeperPlayer[],
  ffcEntry: FfcPlayerEntry,
  ffcPosition: FantasyPosition,
): NameResolution {
  if (candidates.length === 1) {
    return { player: candidates[0]!, matchMethod: "name" };
  }

  const ffcTeam = normalizeTeamCode(ffcEntry.team);
  const byTeam = candidates.filter(
    (c) => c.team !== null && normalizeTeamCode(c.team) === ffcTeam,
  );
  const afterTeam = byTeam.length > 0 ? byTeam : candidates;
  if (afterTeam.length === 1) {
    return { player: afterTeam[0]!, matchMethod: "name-team-tiebreak" };
  }

  const byPosition = afterTeam.filter((c) => c.position === ffcPosition);
  const afterPosition = byPosition.length > 0 ? byPosition : afterTeam;
  if (afterPosition.length === 1) {
    return { player: afterPosition[0]!, matchMethod: "name-position-tiebreak" };
  }

  return candidates;
}

export function matchSleeperToFfc(
  sleeperPlayers: SleeperPlayer[],
  ffcEntries: FfcPlayerEntry[],
): MatchResult {
  const nonDefPlayers = sleeperPlayers.filter((p) => p.position !== "DEF");
  const defPlayers = sleeperPlayers.filter((p) => p.position === "DEF");

  const byName = indexBy(nonDefPlayers, (p) =>
    normalizePlayerName(p.full_name ?? `${p.first_name} ${p.last_name}`),
  );
  const byTeam = indexBy(defPlayers, (p) =>
    p.team === null ? "" : normalizeTeamCode(p.team),
  );

  const matched: MatchedPlayer[] = [];
  const unmatched: UnmatchedFfcEntry[] = [];
  const ambiguous: AmbiguousFfcEntry[] = [];

  for (const ffcEntry of ffcEntries) {
    const ffcPosition = normalizeFfcPosition(ffcEntry.position);
    if (ffcPosition === null) {
      unmatched.push({ ffcEntry, reason: "unrecognized-position" });
      continue;
    }

    if (ffcPosition === "DEF") {
      const candidates = byTeam.get(normalizeTeamCode(ffcEntry.team)) ?? [];
      if (candidates.length === 0) {
        unmatched.push({ ffcEntry, reason: "no-candidates" });
      } else if (candidates.length === 1) {
        const player = candidates[0]!;
        matched.push({
          sleeperPlayer: player,
          ffcEntry,
          matchMethod: "def-team",
          teamComparison: teamComparisonFor(player.team, ffcEntry.team),
        });
      } else {
        ambiguous.push({ ffcEntry, candidates, reason: "multiple-candidates" });
      }
      continue;
    }

    const candidates = byName.get(normalizePlayerName(ffcEntry.name)) ?? [];
    if (candidates.length === 0) {
      unmatched.push({ ffcEntry, reason: "no-candidates" });
      continue;
    }

    const resolved = resolveByName(candidates, ffcEntry, ffcPosition);
    if (Array.isArray(resolved)) {
      ambiguous.push({ ffcEntry, candidates: resolved, reason: "multiple-candidates" });
      continue;
    }

    matched.push({
      sleeperPlayer: resolved.player,
      ffcEntry,
      matchMethod: resolved.matchMethod,
      teamComparison: teamComparisonFor(resolved.player.team, ffcEntry.team),
    });
  }

  return { matched, unmatched, ambiguous };
}
