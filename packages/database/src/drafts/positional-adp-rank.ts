import type { Prisma, ScoringFormat } from "../generated/prisma/client.js";

// Phase 5.6: an internal @fdm/database helper (not exported from the
// package's public entry point — same visibility tier as
// selectPositionAwareBotPlayerId, an implementation detail of BOT turn
// processing) that determines a player's *positional* ADP rank: their
// 1-indexed position within the full rostered player population at that
// same Player.position, ordered by the identical (adp ASC, searchRank ASC
// NULLS LAST, id ASC) rule already used everywhere else in this package.
//
// Deliberately static, not "rank among remaining undrafted players": a
// player's elite/non-elite classification must not change mid-draft merely
// because higher-ranked players at the same position were picked by other
// teams (frozen design decision — see CLAUDE.md's Phase 5.6 notes once
// written). The query below is intentionally NOT scoped by draftId for
// this reason.
//
// Loads the whole positional pool once (a few dozen rows for QB/TE, well
// under the ~1,068-row full rostered pool) and ranks it in memory, rather
// than a SQL "count players with a strictly better tuple" query — this
// reuses the exact same tuple-comparison semantics already established in
// player-selection.ts/position-aware-selection.ts instead of re-deriving
// fragile NULLS-LAST tuple inequality in SQL.
//
// Callers (today: only selectPositionAwareBotPlayerId) are expected to call
// this at most twice per BOT turn — once for an owned QB, once for an owned
// TE, only when that count is exactly 1 — never once per raw candidate.
export async function getPositionalAdpRank(
  tx: Prisma.TransactionClient,
  params: { playerId: string; position: string; scoringFormat: ScoringFormat },
): Promise<number | null> {
  const rows = await tx.player.findMany({
    where: {
      position: params.position,
      nflTeam: { not: null },
      adp: { some: { format: params.scoringFormat, adp: { not: null } } },
    },
    select: {
      id: true,
      searchRank: true,
      adp: { where: { format: params.scoringFormat }, select: { adp: true } },
    },
  });

  const ranked = rows
    .map((row) => ({ id: row.id, adp: row.adp[0]!.adp!, searchRank: row.searchRank }))
    .sort((a, b) => {
      if (a.adp !== b.adp) return a.adp - b.adp;
      const aHasRank = a.searchRank !== null;
      const bHasRank = b.searchRank !== null;
      if (aHasRank !== bHasRank) return aHasRank ? -1 : 1;
      if (aHasRank && bHasRank && a.searchRank !== b.searchRank) {
        return a.searchRank! - b.searchRank!;
      }
      return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
    });

  const index = ranked.findIndex((row) => row.id === params.playerId);
  // A player absent from this list has no usable ADP row for the format —
  // this is exactly how the frozen null-ADP-means-non-elite rule is
  // satisfied, with no separate branch needed.
  return index === -1 ? null : index + 1;
}
