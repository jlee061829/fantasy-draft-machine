import type { PrismaClient } from "../generated/prisma/client.js";
import { ScoringFormat } from "../generated/prisma/enums.js";
import { ADP_SOURCE, SCORING_FORMATS } from "./config.js";
import type { MatchResult } from "./match.js";
import type { SleeperPlayer } from "./schemas/sleeper.js";

export interface PersistSummary {
  playersUpserted: number;
  adpRowsUpserted: number;
}

interface AdpRow {
  playerId: string;
  format: ScoringFormat;
  adp: number | null;
}

function playerDisplayName(player: SleeperPlayer): string {
  return player.full_name ?? `${player.first_name} ${player.last_name}`;
}

// Every fetch/validate/match step must have already succeeded before this is
// called — the whole point of persisting last is that a fetch or matching
// failure never touches the database at all.
//
// Writes happen in five batched statements inside a single transaction,
// instead of one upsert per player/format pair:
//   1. Player    createMany(skipDuplicates) — inserts genuinely new players
//   2. Player    bulk UPDATE via unnest     — refreshes every player row
//   3. Player    findMany                   — sleeperId -> internal id map
//   4. PlayerAdp createMany(skipDuplicates) — inserts new (playerId, format) rows
//   5. PlayerAdp bulk UPDATE via unnest     — sets adp (incl. explicit null) + source
// Steps 2 and 5 are raw SQL because Prisma's updateMany applies one value to
// every matched row — it cannot set a different value per row, which is
// exactly what refreshing per-player/per-format data requires. Every value
// in both raw statements is passed as a bound parameter through Prisma's
// tagged-template $executeRaw (never string-concatenated), and every array
// parameter is explicitly cast so Postgres never has to guess its type.
export async function persistSeedResults(
  prisma: PrismaClient,
  sleeperPlayers: SleeperPlayer[],
  matchResultsByFormat: Record<ScoringFormat, MatchResult>,
): Promise<PersistSummary> {
  return prisma.$transaction(
    async (tx) => {
      // 1. Insert genuinely new players. Prisma generates their cuid ids;
      // existing rows (matched by the sleeperId unique key) are skipped here
      // and refreshed in step 2 instead.
      await tx.player.createMany({
        data: sleeperPlayers.map((p) => ({
          sleeperId: p.player_id,
          fullName: playerDisplayName(p),
          position: p.position,
          nflTeam: p.team,
          searchRank: p.search_rank,
          injuryStatus: p.injury_status,
        })),
        skipDuplicates: true,
      });

      // 2. Refresh every player row (new and pre-existing alike) with this
      // run's Sleeper data in one round trip.
      const sleeperIds = sleeperPlayers.map((p) => p.player_id);
      await tx.$executeRaw`
        UPDATE "Player" AS p
        SET "fullName" = v."fullName",
            "position" = v."position",
            "nflTeam" = v."nflTeam",
            "searchRank" = v."searchRank",
            "injuryStatus" = v."injuryStatus"
        FROM (
          SELECT * FROM unnest(
            ${sleeperIds}::text[],
            ${sleeperPlayers.map(playerDisplayName)}::text[],
            ${sleeperPlayers.map((p) => p.position)}::text[],
            ${sleeperPlayers.map((p) => p.team)}::text[],
            ${sleeperPlayers.map((p) => p.search_rank)}::integer[],
            ${sleeperPlayers.map((p) => p.injury_status)}::text[]
          ) AS t("sleeperId", "fullName", "position", "nflTeam", "searchRank", "injuryStatus")
        ) AS v
        WHERE p."sleeperId" = v."sleeperId"
      `;

      // 3. sleeperId -> internal playerId map, needed for PlayerAdp FKs.
      const playerRows = await tx.player.findMany({
        where: { sleeperId: { in: sleeperIds } },
        select: { id: true, sleeperId: true },
      });
      const playerIdBySleeperId = new Map(
        playerRows.map((row) => [row.sleeperId, row.id]),
      );

      // Build one PlayerAdp row per (player, format): every fantasy-relevant
      // player gets a row for every supported format, with adp set to the
      // matched FFC value or explicit null. This is what makes a successful
      // run represent the *current* snapshot — a player unmatched this run
      // has its adp overwritten to null, never left at a stale prior value.
      const adpRows: AdpRow[] = [];
      for (const format of SCORING_FORMATS) {
        const matchResult = matchResultsByFormat[format];
        const adpBySleeperId = new Map(
          matchResult.matched.map((m) => [m.sleeperPlayer.player_id, m.ffcEntry.adp]),
        );
        for (const sleeperId of sleeperIds) {
          const playerId = playerIdBySleeperId.get(sleeperId);
          if (playerId === undefined) {
            // Unreachable: every sleeperId here was just upserted in steps 1-2.
            throw new Error(
              `Player row missing for sleeperId ${sleeperId} immediately after upsert`,
            );
          }
          adpRows.push({ playerId, format, adp: adpBySleeperId.get(sleeperId) ?? null });
        }
      }

      // 4. Insert new (playerId, format) rows.
      await tx.playerAdp.createMany({
        data: adpRows.map((row) => ({
          playerId: row.playerId,
          format: row.format,
          adp: row.adp,
          source: ADP_SOURCE,
        })),
        skipDuplicates: true,
      });

      // 5. Set adp + source on every (playerId, format) row, including
      // explicit nulls for players unmatched/ambiguous this run.
      await tx.$executeRaw`
        UPDATE "PlayerAdp" AS a
        SET "adp" = v."adp",
            "source" = ${ADP_SOURCE}
        FROM (
          SELECT * FROM unnest(
            ${adpRows.map((r) => r.playerId)}::text[],
            ${adpRows.map((r) => r.format)}::text[],
            ${adpRows.map((r) => r.adp)}::double precision[]
          ) AS t("playerId", "format", "adp")
        ) AS v
        WHERE a."playerId" = v."playerId" AND a."format" = v."format"::"ScoringFormat"
      `;

      return {
        playersUpserted: sleeperPlayers.length,
        adpRowsUpserted: adpRows.length,
      };
    },
    { timeout: 30_000, maxWait: 10_000 },
  );
}
