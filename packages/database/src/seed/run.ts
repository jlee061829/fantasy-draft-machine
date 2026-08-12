import { prisma } from "../client.js";
import { SCORING_FORMATS } from "./config.js";
import { ScoringFormat } from "../generated/prisma/enums.js";
import { fetchFfcAdp } from "./fetch-ffc.js";
import { fetchSleeperPlayers } from "./fetch-sleeper.js";
import { matchSleeperToFfc, type MatchResult } from "./match.js";
import { persistSeedResults } from "./persist.js";
import { reportMatchResults, reportPersistSummary } from "./report.js";

async function main(): Promise<void> {
  console.log("Fetching Sleeper players...");
  const sleeperPlayers = await fetchSleeperPlayers();
  console.log(`Fetched ${sleeperPlayers.length} fantasy-relevant Sleeper players.`);

  const matchResultsByFormat = {} as Record<ScoringFormat, MatchResult>;
  for (const format of SCORING_FORMATS) {
    console.log(`Fetching FFC ADP for ${format}...`);
    const ffcEntries = await fetchFfcAdp(format);
    console.log(`Fetched ${ffcEntries.length} FFC entries for ${format}.`);
    matchResultsByFormat[format] = matchSleeperToFfc(sleeperPlayers, ffcEntries);
  }

  reportMatchResults(matchResultsByFormat);

  console.log("\nPersisting to database...");
  const summary = await persistSeedResults(prisma, sleeperPlayers, matchResultsByFormat);
  reportPersistSummary(summary);
}

main()
  .then(() => {
    console.log("\nSeed complete.");
    return prisma.$disconnect();
  })
  .catch((error: unknown) => {
    console.error("\nSeed failed:", error);
    return prisma.$disconnect().finally(() => {
      process.exitCode = 1;
    });
  });
