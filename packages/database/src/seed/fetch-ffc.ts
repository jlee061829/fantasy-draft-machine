import { FFC_BASE_URL, FFC_FORMAT_PARAMS, FFC_TEAMS, SEED_YEAR } from "./config.js";
import { ScoringFormat } from "../generated/prisma/enums.js";
import { ffcAdpResponseSchema, type FfcPlayerEntry } from "./schemas/ffc.js";

export async function fetchFfcAdp(format: ScoringFormat): Promise<FfcPlayerEntry[]> {
  const formatParam = FFC_FORMAT_PARAMS[format];
  const url = `${FFC_BASE_URL}/${formatParam}?teams=${FFC_TEAMS}&year=${SEED_YEAR}`;

  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(
      `FFC ADP request failed for ${format}: ${response.status} ${response.statusText} (${url})`,
    );
  }

  const rawJson: unknown = await response.json();
  const parsed = ffcAdpResponseSchema.parse(rawJson);

  return parsed.players;
}
