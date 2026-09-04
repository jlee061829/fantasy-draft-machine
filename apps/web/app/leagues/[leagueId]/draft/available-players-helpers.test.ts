import { describe, expect, it } from "vitest";
import type { AvailablePlayer } from "../../../../lib/players/get-available-players";
import {
  ALL_POSITIONS_FILTER,
  computeAdpRanks,
  filterAvailablePlayers,
} from "./available-players-helpers";

const players: AvailablePlayer[] = [
  { id: "p1", fullName: "Ja'Marr Chase", position: "WR", nflTeam: "CIN", adp: 1.8, searchRank: 1 },
  { id: "p2", fullName: "Bijan Robinson", position: "RB", nflTeam: "ATL", adp: 2.4, searchRank: 2 },
  { id: "p3", fullName: "Jahmyr Gibbs", position: "RB", nflTeam: "DET", adp: 3.1, searchRank: 3 },
  { id: "p4", fullName: "Patrick Mahomes", position: "QB", nflTeam: "KC", adp: null, searchRank: 50 },
];

describe("filterAvailablePlayers", () => {
  it("returns every player unfiltered when search is empty and position is All", () => {
    const result = filterAvailablePlayers(players, new Set(), "", ALL_POSITIONS_FILTER);
    expect(result.map((p) => p.id)).toEqual(["p1", "p2", "p3", "p4"]);
  });

  it("matches player names case-insensitively", () => {
    const result = filterAvailablePlayers(players, new Set(), "bijan", ALL_POSITIONS_FILTER);
    expect(result.map((p) => p.id)).toEqual(["p2"]);
  });

  it("matches partial names", () => {
    const result = filterAvailablePlayers(players, new Set(), "gibb", ALL_POSITIONS_FILTER);
    expect(result.map((p) => p.id)).toEqual(["p3"]);
  });

  it("treats whitespace-only search the same as empty search", () => {
    const result = filterAvailablePlayers(players, new Set(), "   ", ALL_POSITIONS_FILTER);
    expect(result.map((p) => p.id)).toEqual(["p1", "p2", "p3", "p4"]);
  });

  it("returns an empty array when nothing matches the search", () => {
    const result = filterAvailablePlayers(players, new Set(), "zzz-nobody", ALL_POSITIONS_FILTER);
    expect(result).toEqual([]);
  });

  it("filters by exact position", () => {
    const result = filterAvailablePlayers(players, new Set(), "", "RB");
    expect(result.map((p) => p.id)).toEqual(["p2", "p3"]);
  });

  it("passes every position through when the filter is All", () => {
    const result = filterAvailablePlayers(players, new Set(), "", ALL_POSITIONS_FILTER);
    expect(result).toHaveLength(4);
  });

  it("combines search and position filters with AND", () => {
    const result = filterAvailablePlayers(players, new Set(), "gibbs", "RB");
    expect(result.map((p) => p.id)).toEqual(["p3"]);

    const noMatch = filterAvailablePlayers(players, new Set(), "gibbs", "WR");
    expect(noMatch).toEqual([]);
  });

  it("excludes drafted players regardless of search/position state", () => {
    const draftedIds = new Set(["p1", "p3"]);
    const result = filterAvailablePlayers(players, draftedIds, "", ALL_POSITIONS_FILTER);
    expect(result.map((p) => p.id)).toEqual(["p2", "p4"]);
  });
});

describe("computeAdpRanks", () => {
  // Raw ADPs are the deliberately non-integer values from the corrected
  // spec (Gibbs 1.7, Bijan 1.9, Puka 2.9, Chase 3.9) — the ranks below must
  // come from ordinal position (1, 2, 3, 4), never from flooring/rounding
  // the raw number.
  const rankedPlayers: AvailablePlayer[] = [
    { id: "gibbs", fullName: "Jahmyr Gibbs", position: "RB", nflTeam: "DET", adp: 1.7, searchRank: 1 },
    { id: "bijan", fullName: "Bijan Robinson", position: "RB", nflTeam: "ATL", adp: 1.9, searchRank: 2 },
    { id: "puka", fullName: "Puka Nacua", position: "WR", nflTeam: "LAR", adp: 2.9, searchRank: 3 },
    { id: "chase", fullName: "Ja'Marr Chase", position: "WR", nflTeam: "CIN", adp: 3.9, searchRank: 4 },
    { id: "noadp", fullName: "No ADP Guy", position: "QB", nflTeam: "KC", adp: null, searchRank: 50 },
  ];

  it("assigns sequential integer ranks by position in the sorted pool, not by rounding/flooring the raw adp", () => {
    const ranks = computeAdpRanks(rankedPlayers);
    expect(ranks.get("gibbs")).toBe(1);
    expect(ranks.get("bijan")).toBe(2);
    expect(ranks.get("puka")).toBe(3);
    expect(ranks.get("chase")).toBe(4);
  });

  it("leaves a null-adp player unranked rather than inventing a rank", () => {
    const ranks = computeAdpRanks(rankedPlayers);
    expect(ranks.has("noadp")).toBe(false);
  });

  it("stays anchored to full-pool position after filtering, e.g. an overall #3 stays 3 even as the first visible WR", () => {
    const fullPoolRanks = computeAdpRanks(rankedPlayers);
    expect(fullPoolRanks.get("puka")).toBe(3);
    expect(fullPoolRanks.get("chase")).toBe(4);

    // Filtering to WR drops Gibbs/Bijan (both RB), leaving Puka as the
    // first *visible* row — but he must still display "3", not "1".
    const wrOnly = filterAvailablePlayers(rankedPlayers, new Set(), "", "WR");
    expect(wrOnly.map((p) => p.id)).toEqual(["puka", "chase"]);
    expect(fullPoolRanks.get("puka")).toBe(3);
    expect(fullPoolRanks.get("chase")).toBe(4);

    // Demonstrates why the caller must compute ranks from the full pool:
    // recomputing from the already-filtered subset would incorrectly
    // renumber Puka/Chase back to 1/2.
    const wronglyRecomputedFromFilteredPool = computeAdpRanks(wrOnly);
    expect(wronglyRecomputedFromFilteredPool.get("puka")).toBe(1);
    expect(wronglyRecomputedFromFilteredPool.get("chase")).toBe(2);
  });

  it("stays anchored to full-pool position after a search that reorders which row appears first", () => {
    const fullPoolRanks = computeAdpRanks(rankedPlayers);

    const searched = filterAvailablePlayers(rankedPlayers, new Set(), "chase", ALL_POSITIONS_FILTER);
    expect(searched.map((p) => p.id)).toEqual(["chase"]);

    // Chase is the only visible row, but still ranks 4th overall.
    expect(fullPoolRanks.get("chase")).toBe(4);
  });

  it("returns an empty map for an empty pool", () => {
    expect(computeAdpRanks([])).toEqual(new Map());
  });
});
