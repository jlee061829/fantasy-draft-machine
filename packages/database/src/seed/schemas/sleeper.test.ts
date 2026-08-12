import { describe, expect, it } from "vitest";
import { sleeperPlayerSchema } from "./sleeper.js";

function baseEntry(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    player_id: "1234",
    first_name: "Patrick",
    last_name: "Mahomes",
    full_name: "Patrick Mahomes",
    position: "QB",
    team: "KC",
    search_rank: 5,
    injury_status: null,
    ...overrides,
  };
}

describe("sleeperPlayerSchema search_rank normalization", () => {
  it("keeps a numeric search_rank as-is", () => {
    const result = sleeperPlayerSchema.parse(baseEntry({ search_rank: 12 }));
    expect(result.search_rank).toBe(12);
  });

  it("normalizes an explicit null search_rank to null", () => {
    const result = sleeperPlayerSchema.parse(baseEntry({ search_rank: null }));
    expect(result.search_rank).toBeNull();
  });

  it("normalizes an omitted search_rank (e.g. DEF entries) to null", () => {
    const entry = baseEntry();
    delete entry.search_rank;

    const result = sleeperPlayerSchema.parse(entry);
    expect(result.search_rank).toBeNull();
  });
});
