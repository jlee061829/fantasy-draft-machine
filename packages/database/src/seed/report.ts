import { ScoringFormat } from "../generated/prisma/enums.js";
import type { MatchResult } from "./match.js";
import type { SleeperPlayer } from "./schemas/sleeper.js";

function candidateLabel(player: SleeperPlayer): string {
  const name = player.full_name ?? `${player.first_name} ${player.last_name}`;
  return `${name} (sleeperId=${player.player_id}, ${player.position}, team=${player.team ?? "unknown"})`;
}

function reportFormat(format: ScoringFormat, result: MatchResult): void {
  const { matched, unmatched, ambiguous } = result;
  console.log(
    `\n${format} — matched: ${matched.length}, unmatched: ${unmatched.length}, ambiguous: ${ambiguous.length}`,
  );

  for (const entry of unmatched) {
    console.log(
      `  unmatched (${entry.reason}): ${entry.ffcEntry.name} (${entry.ffcEntry.position}, team=${entry.ffcEntry.team})`,
    );
  }

  for (const entry of ambiguous) {
    console.log(
      `  ambiguous: ${entry.ffcEntry.name} (${entry.ffcEntry.position}, team=${entry.ffcEntry.team}) candidates: ${entry.candidates
        .map(candidateLabel)
        .join("; ")}`,
    );
  }
}

export function reportMatchResults(
  matchResultsByFormat: Record<ScoringFormat, MatchResult>,
): void {
  console.log("=== FFC match report ===");
  for (const format of Object.values(ScoringFormat)) {
    reportFormat(format, matchResultsByFormat[format]);
  }
}

export function reportPersistSummary(summary: {
  playersUpserted: number;
  adpRowsUpserted: number;
}): void {
  console.log(
    `\n=== persisted ${summary.playersUpserted} players, ${summary.adpRowsUpserted} PlayerAdp rows (across all formats) ===`,
  );
}
