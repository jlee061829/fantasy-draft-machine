import { describe, expect, it } from "vitest";
import { matchSleeperToFfc } from "./match.js";
import type { FfcPlayerEntry } from "./schemas/ffc.js";
import type { SleeperPlayer } from "./schemas/sleeper.js";

let sleeperIdCounter = 0;
function sleeperPlayer(overrides: Partial<SleeperPlayer> = {}): SleeperPlayer {
  sleeperIdCounter += 1;
  return {
    player_id: `sleeper-${sleeperIdCounter}`,
    first_name: "First",
    last_name: "Last",
    full_name: "First Last",
    position: "WR",
    team: "KC",
    search_rank: 100,
    injury_status: null,
    ...overrides,
  };
}

function ffcEntry(overrides: Partial<FfcPlayerEntry> = {}): FfcPlayerEntry {
  return {
    name: "First Last",
    position: "WR",
    team: "KC",
    adp: 10,
    ...overrides,
  };
}

describe("matchSleeperToFfc", () => {
  it("matches an exact normalized name", () => {
    const sleeper = sleeperPlayer({ full_name: "Christian McCaffrey", team: "SF" });
    const ffc = ffcEntry({ name: "Christian McCaffrey", team: "SF" });

    const result = matchSleeperToFfc([sleeper], [ffc]);

    expect(result.matched).toEqual([
      {
        sleeperPlayer: sleeper,
        ffcEntry: ffc,
        matchMethod: "name",
        teamComparison: "same",
      },
    ]);
    expect(result.unmatched).toEqual([]);
    expect(result.ambiguous).toEqual([]);
  });

  it("matches through suffix/punctuation normalization", () => {
    const sleeper = sleeperPlayer({ full_name: "Brian Thomas", team: "JAX" });
    const ffc = ffcEntry({ name: "Brian Thomas Jr.", team: "JAX" });

    const result = matchSleeperToFfc([sleeper], [ffc]);

    expect(result.matched).toHaveLength(1);
    expect(result.matched[0]!.sleeperPlayer).toBe(sleeper);
    expect(result.matched[0]!.matchMethod).toBe("name");
  });

  it("still matches uniquely when the team changed between sources", () => {
    const sleeper = sleeperPlayer({ full_name: "Traded Player", team: "KC" });
    const ffc = ffcEntry({ name: "Traded Player", team: "NYJ" });

    const result = matchSleeperToFfc([sleeper], [ffc]);

    expect(result.matched).toEqual([
      {
        sleeperPlayer: sleeper,
        ffcEntry: ffc,
        matchMethod: "name",
        teamComparison: "different",
      },
    ]);
  });

  it("treats a missing Sleeper team as unknown, not a mismatch", () => {
    const sleeper = sleeperPlayer({ full_name: "No Team Guy", team: null });
    const ffc = ffcEntry({ name: "No Team Guy", team: "NYJ" });

    const result = matchSleeperToFfc([sleeper], [ffc]);

    expect(result.matched[0]!.teamComparison).toBe("unknown");
  });

  it("matches FFC's PK position to Sleeper's K", () => {
    const sleeper = sleeperPlayer({
      full_name: "Foot Guy",
      position: "K",
      team: "BAL",
    });
    const ffc = ffcEntry({ name: "Foot Guy", position: "PK", team: "BAL" });

    const result = matchSleeperToFfc([sleeper], [ffc]);

    expect(result.matched).toHaveLength(1);
    expect(result.matched[0]!.sleeperPlayer).toBe(sleeper);
  });

  it("matches a defense by team code, not by name", () => {
    const sleeper = sleeperPlayer({
      first_name: "Denver",
      last_name: "Broncos",
      full_name: null,
      position: "DEF",
      team: "DEN",
    });
    const ffc = ffcEntry({ name: "Denver Defense", position: "DEF", team: "DEN" });

    const result = matchSleeperToFfc([sleeper], [ffc]);

    expect(result.matched).toEqual([
      {
        sleeperPlayer: sleeper,
        ffcEntry: ffc,
        matchMethod: "def-team",
        teamComparison: "same",
      },
    ]);
  });

  it("reports no match when there are no name candidates", () => {
    const sleeper = sleeperPlayer({ full_name: "Someone Else" });
    const ffc = ffcEntry({ name: "Nobody Matching" });

    const result = matchSleeperToFfc([sleeper], [ffc]);

    expect(result.matched).toEqual([]);
    expect(result.unmatched).toEqual([
      { ffcEntry: ffc, reason: "no-candidates" },
    ]);
  });

  it("reports an unrecognized FFC position instead of guessing", () => {
    const sleeper = sleeperPlayer({ full_name: "Some Guy" });
    const ffc = ffcEntry({ name: "Some Guy", position: "LB" });

    const result = matchSleeperToFfc([sleeper], [ffc]);

    expect(result.matched).toEqual([]);
    expect(result.unmatched).toEqual([
      { ffcEntry: ffc, reason: "unrecognized-position" },
    ]);
  });

  it("reports ambiguous when a duplicate name can't be disambiguated by team or position", () => {
    const sleeperA = sleeperPlayer({
      full_name: "Mike Williams",
      position: "WR",
      team: "NYJ",
    });
    const sleeperB = sleeperPlayer({
      full_name: "Mike Williams",
      position: "TE",
      team: "LAC",
    });
    const ffc = ffcEntry({ name: "Mike Williams", position: "RB", team: "DAL" });

    const result = matchSleeperToFfc([sleeperA, sleeperB], [ffc]);

    expect(result.matched).toEqual([]);
    expect(result.ambiguous).toEqual([
      {
        ffcEntry: ffc,
        candidates: [sleeperA, sleeperB],
        reason: "multiple-candidates",
      },
    ]);
  });

  it("resolves a duplicate name via the team tiebreak when the FFC team matches exactly one candidate", () => {
    const sleeperA = sleeperPlayer({
      full_name: "Mike Williams",
      position: "WR",
      team: "NYJ",
    });
    const sleeperB = sleeperPlayer({
      full_name: "Mike Williams",
      position: "TE",
      team: "LAC",
    });
    const ffc = ffcEntry({ name: "Mike Williams", position: "WR", team: "LAC" });

    const result = matchSleeperToFfc([sleeperA, sleeperB], [ffc]);

    expect(result.ambiguous).toEqual([]);
    expect(result.matched).toEqual([
      {
        sleeperPlayer: sleeperB,
        ffcEntry: ffc,
        matchMethod: "name-team-tiebreak",
        teamComparison: "same",
      },
    ]);
  });

  it("resolves a duplicate name via the position tiebreak when team doesn't disambiguate", () => {
    const sleeperA = sleeperPlayer({
      full_name: "Mike Williams",
      position: "WR",
      team: "DAL",
    });
    const sleeperB = sleeperPlayer({
      full_name: "Mike Williams",
      position: "TE",
      team: "DAL",
    });
    const ffc = ffcEntry({ name: "Mike Williams", position: "TE", team: "DAL" });

    const result = matchSleeperToFfc([sleeperA, sleeperB], [ffc]);

    expect(result.ambiguous).toEqual([]);
    expect(result.matched).toEqual([
      {
        sleeperPlayer: sleeperB,
        ffcEntry: ffc,
        matchMethod: "name-position-tiebreak",
        teamComparison: "same",
      },
    ]);
  });

  it("is deterministic across repeated calls with the same input", () => {
    const sleeperPlayers = [
      sleeperPlayer({ full_name: "Player One", team: "KC" }),
      sleeperPlayer({ full_name: "Player Two", team: "SF" }),
    ];
    const ffcEntries = [
      ffcEntry({ name: "Player One", team: "KC" }),
      ffcEntry({ name: "Player Two", team: "SF" }),
      ffcEntry({ name: "Unmatched Guy", team: "BUF" }),
    ];

    const first = matchSleeperToFfc(sleeperPlayers, ffcEntries);
    const second = matchSleeperToFfc(sleeperPlayers, ffcEntries);

    expect(second).toEqual(first);
  });
});
