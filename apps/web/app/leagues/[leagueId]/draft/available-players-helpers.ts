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
