import { describe, expect, it } from "vitest";
import type { AvailablePlayer } from "../../../../lib/players/get-available-players";
import { ALL_POSITIONS_FILTER, filterAvailablePlayers } from "./available-players-helpers";

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
