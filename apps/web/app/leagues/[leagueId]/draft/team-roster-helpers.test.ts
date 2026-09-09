import type { DraftStateResult, DraftStatePick } from "@fdm/shared";
import { describe, expect, it } from "vitest";
import { deriveTeamRosters } from "./team-roster-helpers";

const league: DraftStateResult["league"] = {
  id: "league-1",
  name: "Test League",
  rosterSize: 15,
  teamCount: 3,
  scoringFormat: "PPR",
  draftType: "SNAKE",
  timerSeconds: 60,
};

// Phase 5.1: m3 is a BOT (no userId) — deriveTeamRosters groups by
// membershipId, not userId, precisely so a bot's roster works with no
// special-casing.
const members: DraftStateResult["members"] = [
  { membershipId: "m1", participantType: "HUMAN", userId: "user-1", name: "Alice", image: null, draftSlot: 1 },
  { membershipId: "m2", participantType: "HUMAN", userId: "user-2", name: "Bob", image: null, draftSlot: 2 },
  { membershipId: "m3", participantType: "BOT", userId: null, name: "CPU 1", image: null, draftSlot: 3 },
];

function pick(
  pickNumber: number,
  leagueMemberId: string,
  overrides: Partial<DraftStatePick> = {},
): DraftStatePick {
  return {
    pickNumber,
    leagueMemberId,
    playerId: `player-${pickNumber}`,
    playerName: `Player ${pickNumber}`,
    playerPosition: "RB",
    playerNflTeam: "CIN",
    wasAutopick: false,
    createdAt: new Date(0).toISOString(),
    ...overrides,
  };
}

function state(picks: DraftStatePick[]): DraftStateResult {
  return {
    league,
    members,
    draft: null,
    picks,
  };
}

describe("deriveTeamRosters", () => {
  it("returns one roster per member, in state.members' draftSlot order, even with no picks", () => {
    const rosters = deriveTeamRosters(state([]));
    expect(rosters.map((r) => r.membershipId)).toEqual(["m1", "m2", "m3"]);
    expect(rosters.every((r) => r.picks.length === 0)).toBe(true);
  });

  it("groups picks by membershipId (leagueMemberId)", () => {
    const rosters = deriveTeamRosters(state([pick(1, "m1"), pick(2, "m2"), pick(3, "m1")]));
    const alice = rosters.find((r) => r.membershipId === "m1");
    const bob = rosters.find((r) => r.membershipId === "m2");
    expect(alice?.picks.map((p) => p.pickNumber)).toEqual([1, 3]);
    expect(bob?.picks.map((p) => p.pickNumber)).toEqual([2]);
  });

  it("groups a BOT member's picks the same way, with no userId involved", () => {
    const rosters = deriveTeamRosters(state([pick(1, "m1"), pick(2, "m3"), pick(3, "m3")]));
    const bot = rosters.find((r) => r.membershipId === "m3");
    expect(bot?.userId).toBeNull();
    expect(bot?.name).toBe("CPU 1");
    expect(bot?.picks.map((p) => p.pickNumber)).toEqual([2, 3]);
  });

  it("keeps a member's picks in ascending pickNumber order across multiple rounds", () => {
    // state.picks is always pickNumber-ascending upstream (get-draft-state.ts
    // orders by pickNumber); deriveTeamRosters uses a plain filter, which
    // preserves that order rather than re-sorting, so a member's picks
    // spanning several rounds (here: rounds 1, 2, and 3 of a 3-team draft)
    // come out in the order they were actually made.
    const rosters = deriveTeamRosters(state([pick(1, "m1"), pick(4, "m1"), pick(9, "m1")]));
    const alice = rosters.find((r) => r.membershipId === "m1");
    expect(alice?.picks.map((p) => p.pickNumber)).toEqual([1, 4, 9]);
  });

  it("carries autopick metadata through unchanged", () => {
    const rosters = deriveTeamRosters(state([pick(1, "m1", { wasAutopick: true })]));
    expect(rosters.find((r) => r.membershipId === "m1")?.picks[0]?.wasAutopick).toBe(true);
  });

  it("returns an empty roster list only for members with genuinely zero picks, not omitting them", () => {
    const rosters = deriveTeamRosters(state([pick(1, "m1")]));
    expect(rosters).toHaveLength(3);
    expect(rosters.find((r) => r.membershipId === "m3")?.picks).toEqual([]);
  });
});
