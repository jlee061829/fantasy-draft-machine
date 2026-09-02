import type { ScoringFormat } from "@fdm/database";
import { prisma } from "@fdm/database";

// Milestone 4.3's player-discovery DTO. Web-only (never crosses the
// socket-server transport boundary the way DraftStateResult does), so it
// lives here rather than in @fdm/shared or @fdm/database, following the same
// convention as LeagueDetailResult/MyLeagueSummary. searchRank is kept only
// as an ordering tiebreaker input, not as a user-facing ranking field — see
// AvailablePlayersPanel, which never renders it.
export interface AvailablePlayer {
  id: string;
  fullName: string;
  position: string;
  nflTeam: string;
  adp: number | null;
  searchRank: number | null;
}

// The production draft-room discovery surface currently includes rostered
// NFL players (nflTeam IS NOT NULL). Of the ~4,262 seeded Player rows, only
// ~1,068 currently have a team — the rest are inactive/historical/provider
// noise no one would search for in a live draft. Expanding discovery to free
// agents or other provider records would be a future explicit product/data
// decision, not something this milestone does implicitly.
//
// Rooted on PlayerAdp (not Player) because every Player has exactly one
// PlayerAdp row per ScoringFormat (see CLAUDE.md's seed-pipeline invariant),
// so filtering by `format` here always yields exactly the rostered-player
// pool with that format's ADP already attached — no separate join/merge
// step. Ordering: real ADP ascending first (nulls sort last, so ADP-less
// players always fall after every player with a real number), then
// searchRank ascending (nulls last) as the fallback tiebreak among ADP-less
// players, then id ascending as a final fully-deterministic tiebreak. This
// mirrors selectAutopickPlayerId's tiering in packages/database's
// autopick.ts, generalized from "pick one" to "produce a total order."
export async function getAvailablePlayers(scoringFormat: ScoringFormat): Promise<AvailablePlayer[]> {
  const rows = await prisma.playerAdp.findMany({
    where: {
      format: scoringFormat,
      player: { nflTeam: { not: null } },
    },
    select: {
      adp: true,
      player: {
        select: {
          id: true,
          fullName: true,
          position: true,
          nflTeam: true,
          searchRank: true,
        },
      },
    },
    orderBy: [
      { adp: { sort: "asc", nulls: "last" } },
      { player: { searchRank: { sort: "asc", nulls: "last" } } },
      { player: { id: "asc" } },
    ],
  });

  return rows.map((row) => ({
    id: row.player.id,
    fullName: row.player.fullName,
    position: row.player.position,
    // Safe: the where clause guarantees player.nflTeam is not null here.
    nflTeam: row.player.nflTeam as string,
    adp: row.adp,
    searchRank: row.player.searchRank,
  }));
}
