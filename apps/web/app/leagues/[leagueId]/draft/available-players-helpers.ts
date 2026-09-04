import type { AvailablePlayer } from "../../../../lib/players/get-available-players";

// Pure, DOM-free filtering over the already server-sorted AvailablePlayer[]
// pool — mirrors draft-room-helpers.ts's pattern of deriving display state
// from data the caller already has, rather than owning any state itself.
export const ALL_POSITIONS_FILTER = "ALL" as const;
export type PositionFilter = typeof ALL_POSITIONS_FILTER | string;

// Case-insensitive, trimmed, partial match against fullName only — team
// abbreviation search is intentionally out of scope for 4.3.
function matchesSearch(player: AvailablePlayer, normalizedSearch: string): boolean {
  if (normalizedSearch === "") return true;
  return player.fullName.toLowerCase().includes(normalizedSearch);
}

function matchesPosition(player: AvailablePlayer, position: PositionFilter): boolean {
  if (position === ALL_POSITIONS_FILTER) return true;
  return player.position === position;
}

// Search and position combine with AND. Drafted players are excluded
// regardless of search/filter state — draftedPlayerIds is derived from
// authoritative DraftStateResult.picks by getDraftedPlayerIds (see
// draft-room-helpers.ts), never a second mutable collection. Input order
// (already ADP/searchRank/id sorted server-side) is preserved.
export function filterAvailablePlayers(
  players: AvailablePlayer[],
  draftedPlayerIds: Set<string>,
  search: string,
  position: PositionFilter,
): AvailablePlayer[] {
  const normalizedSearch = search.trim().toLowerCase();
  return players.filter(
    (player) =>
      !draftedPlayerIds.has(player.id) &&
      matchesSearch(player, normalizedSearch) &&
      matchesPosition(player, position),
  );
}

// A stable, 1-indexed display rank per player, derived from position in the
// FULL pool passed in — never from a filtered/visible subset. Callers must
// always compute this from the complete AvailablePlayer[] prop (see
// AvailablePlayersPanel), so a player's rank never changes when the user
// searches or applies a position filter, per the product requirement that
// e.g. an overall-#1 player stays "1" even after filtering down to just his
// position.
//
// getAvailablePlayers already returns players ADP-ascending with nulls last,
// using the exact same deterministic (adp, searchRank, id) tiebreak order
// selectAutopickPlayerId uses server-side — so a simple sequential counter
// over that existing order reproduces "position in the full ADP-sorted
// pool" with no separate sort/tiebreak logic duplicated here. Only players
// with a real (non-null) adp receive a rank; a null-adp player is
// deliberately left unranked (not appended at the end) rather than inventing
// an ADP rank for a player with no ADP.
export function computeAdpRanks(players: AvailablePlayer[]): Map<string, number> {
  const ranks = new Map<string, number>();
  let rank = 0;
  for (const player of players) {
    if (player.adp === null) continue;
    rank += 1;
    ranks.set(player.id, rank);
  }
  return ranks;
}
