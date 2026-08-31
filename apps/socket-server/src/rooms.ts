// Single source of truth for the realtime room a league's draft lives in.
// Keyed by leagueId, not draftId: a socket may join before a Draft exists
// (pre-draft state has draft: null), and leagueId is stable across that
// transition while draftId isn't available yet.
export function leagueRoomName(leagueId: string): string {
  return `league:${leagueId}`;
}
