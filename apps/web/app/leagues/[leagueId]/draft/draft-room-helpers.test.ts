import type { DraftStateResult } from "@fdm/shared";
import { describe, expect, it } from "vitest";
import {
  formatCountdown,
  getCountdownUrgency,
  getCurrentPickerName,
  getDraftedPlayerIds,
  getDraftPhase,
  getMsRemaining,
  getRoundInfo,
  isYourTurn,
} from "./draft-room-helpers";

// Pure-function unit tests, no Postgres and no DOM: these exercise only the
// display logic built on top of an already-authoritative DraftStateResult.
// Turn-order correctness, timer authority, and autopick are Phase 3 concerns
// already covered in packages/database and apps/socket-server — not
// retested here.

const baseLeague: DraftStateResult["league"] = {
  id: "league-1",
  name: "Test League",
  rosterSize: 16,
  teamCount: 4,
  scoringFormat: "PPR",
  draftType: "SNAKE",
  timerSeconds: 60,
};

// Phase 5.1: members are keyed by membershipId, not userId — currentMemberId
// (the picker on the clock) and Pick.leagueMemberId both resolve against
// membershipId. A BOT member (m3) has no userId, exercising the
// human-viewer-vs-bot-picker distinction isYourTurn exists to get right.
const members: DraftStateResult["members"] = [
  { membershipId: "m1", participantType: "HUMAN", userId: "user-1", name: "Alice", image: null, draftSlot: 1 },
  { membershipId: "m2", participantType: "HUMAN", userId: "user-2", name: "Bob", image: null, draftSlot: 2 },
  { membershipId: "m3", participantType: "BOT", userId: null, name: "CPU 1", image: null, draftSlot: 3 },
];

function stateWithDraft(draft: DraftStateResult["draft"]): DraftStateResult {
  return { league: baseLeague, members, draft, picks: [] };
}

describe("getDraftPhase", () => {
  it("returns PENDING when there is no Draft yet", () => {
    expect(getDraftPhase(null)).toBe("PENDING");
  });

  it("returns ACTIVE for an in-progress Draft", () => {
    expect(
      getDraftPhase({
        id: "d1",
        status: "ACTIVE",
        currentPickNumber: 3,
        currentMemberId: "m1",
        turnDeadline: null,
      }),
    ).toBe("ACTIVE");
  });

  it("returns COMPLETE for a finished Draft", () => {
    expect(
      getDraftPhase({
        id: "d1",
        status: "COMPLETE",
        currentPickNumber: 64,
        currentMemberId: null,
        turnDeadline: null,
      }),
    ).toBe("COMPLETE");
  });
});

describe("getCurrentPickerName", () => {
  it("returns null when there is no Draft", () => {
    expect(getCurrentPickerName(stateWithDraft(null))).toBeNull();
  });

  it("returns null when the Draft is complete (currentMemberId cleared)", () => {
    const state = stateWithDraft({
      id: "d1",
      status: "COMPLETE",
      currentPickNumber: 64,
      currentMemberId: null,
      turnDeadline: null,
    });
    expect(getCurrentPickerName(state)).toBeNull();
  });

  it("returns the matching member's name", () => {
    const state = stateWithDraft({
      id: "d1",
      status: "ACTIVE",
      currentPickNumber: 1,
      currentMemberId: "m2",
      turnDeadline: null,
    });
    expect(getCurrentPickerName(state)).toBe("Bob");
  });

  it("falls back to a safe placeholder for an unmatched currentMemberId", () => {
    const state = stateWithDraft({
      id: "d1",
      status: "ACTIVE",
      currentPickNumber: 1,
      currentMemberId: "some-other-membership",
      turnDeadline: null,
    });
    expect(getCurrentPickerName(state)).toBe("Unknown manager");
  });

  it("returns a BOT member's normalized (displayName-derived) name when it is on the clock", () => {
    const state = stateWithDraft({
      id: "d1",
      status: "ACTIVE",
      currentPickNumber: 1,
      currentMemberId: "m3",
      turnDeadline: null,
    });
    expect(getCurrentPickerName(state)).toBe("CPU 1");
  });
});

describe("isYourTurn", () => {
  it("is false when there is no Draft", () => {
    expect(isYourTurn(stateWithDraft(null), "user-1")).toBe(false);
  });

  it("is false when the Draft is complete", () => {
    const state = stateWithDraft({
      id: "d1",
      status: "COMPLETE",
      currentPickNumber: 64,
      currentMemberId: null,
      turnDeadline: null,
    });
    expect(isYourTurn(state, "user-1")).toBe(false);
  });

  it("is true only for the current picker", () => {
    const state = stateWithDraft({
      id: "d1",
      status: "ACTIVE",
      currentPickNumber: 1,
      currentMemberId: "m1",
      turnDeadline: null,
    });
    expect(isYourTurn(state, "user-1")).toBe(true);
    expect(isYourTurn(state, "user-2")).toBe(false);
  });

  it("is false for every human viewer when a BOT is on the clock", () => {
    const state = stateWithDraft({
      id: "d1",
      status: "ACTIVE",
      currentPickNumber: 3,
      currentMemberId: "m3",
      turnDeadline: null,
    });
    expect(isYourTurn(state, "user-1")).toBe(false);
    expect(isYourTurn(state, "user-2")).toBe(false);
  });
});

describe("getMsRemaining", () => {
  it("is 0 for a null deadline", () => {
    expect(getMsRemaining(null, Date.now())).toBe(0);
  });

  it("is positive for a future deadline", () => {
    const now = 1_000_000;
    const deadline = new Date(now + 42_000).toISOString();
    expect(getMsRemaining(deadline, now)).toBe(42_000);
  });

  it("clamps to 0 for a past deadline", () => {
    const now = 1_000_000;
    const deadline = new Date(now - 5_000).toISOString();
    expect(getMsRemaining(deadline, now)).toBe(0);
  });
});

describe("formatCountdown", () => {
  it("formats zero as 0:00", () => {
    expect(formatCountdown(0)).toBe("0:00");
  });

  it("formats sub-minute values with a zero-padded seconds field", () => {
    expect(formatCountdown(9_000)).toBe("0:09");
  });

  it("formats multi-minute values", () => {
    expect(formatCountdown(125_000)).toBe("2:05");
  });

  it("floors partial seconds rather than rounding up", () => {
    expect(formatCountdown(1_999)).toBe("0:01");
  });

  it("clamps negative input defensively", () => {
    expect(formatCountdown(-500)).toBe("0:00");
  });
});

function pick(pickNumber: number, playerId: string): DraftStateResult["picks"][number] {
  return {
    pickNumber,
    leagueMemberId: "m1",
    playerId,
    playerName: "Test Player",
    playerPosition: "RB",
    playerNflTeam: "CIN",
    wasAutopick: false,
    createdAt: new Date(0).toISOString(),
  };
}

describe("getDraftedPlayerIds", () => {
  it("returns an empty set when there are no picks", () => {
    const state = stateWithDraft(null);
    expect(getDraftedPlayerIds(state)).toEqual(new Set());
  });

  it("returns the set of every drafted playerId", () => {
    const state: DraftStateResult = {
      ...stateWithDraft(null),
      picks: [pick(1, "player-a"), pick(2, "player-b")],
    };
    expect(getDraftedPlayerIds(state)).toEqual(new Set(["player-a", "player-b"]));
  });

  it("does not duplicate a repeated playerId", () => {
    const state: DraftStateResult = {
      ...stateWithDraft(null),
      picks: [pick(1, "player-a"), pick(2, "player-a")],
    };
    const ids = getDraftedPlayerIds(state);
    expect(ids.size).toBe(1);
    expect(ids.has("player-a")).toBe(true);
  });
});

describe("getRoundInfo", () => {
  it("is null when there is no Draft", () => {
    expect(getRoundInfo(stateWithDraft(null))).toBeNull();
  });

  it("is null once the Draft is COMPLETE", () => {
    const state = stateWithDraft({
      id: "d1",
      status: "COMPLETE",
      currentPickNumber: 64,
      currentMemberId: null,
      turnDeadline: null,
    });
    expect(getRoundInfo(state)).toBeNull();
  });

  it("derives round/total/pickNumber for an early pick", () => {
    // baseLeague: teamCount 4, rosterSize 16.
    const state = stateWithDraft({
      id: "d1",
      status: "ACTIVE",
      currentPickNumber: 1,
      currentMemberId: "m1",
      turnDeadline: null,
    });
    expect(getRoundInfo(state)).toEqual({ round: 1, totalRounds: 16, pickNumber: 1 });
  });

  it("rolls over to the next round exactly at the boundary", () => {
    const state = stateWithDraft({
      id: "d1",
      status: "ACTIVE",
      currentPickNumber: 5,
      currentMemberId: "m1",
      turnDeadline: null,
    });
    expect(getRoundInfo(state)).toEqual({ round: 2, totalRounds: 16, pickNumber: 5 });
  });

  it("reports the final round for the last pick", () => {
    const state = stateWithDraft({
      id: "d1",
      status: "ACTIVE",
      currentPickNumber: 64,
      currentMemberId: "m1",
      turnDeadline: null,
    });
    expect(getRoundInfo(state)).toEqual({ round: 16, totalRounds: 16, pickNumber: 64 });
  });
});

describe("getCountdownUrgency", () => {
  it("is critical at and below 5 seconds remaining, including zero", () => {
    expect(getCountdownUrgency(0)).toBe("critical");
    expect(getCountdownUrgency(5_000)).toBe("critical");
  });

  it("is warning between 5 and 15 seconds remaining", () => {
    expect(getCountdownUrgency(5_001)).toBe("warning");
    expect(getCountdownUrgency(15_000)).toBe("warning");
  });

  it("is normal above 15 seconds remaining", () => {
    expect(getCountdownUrgency(15_001)).toBe("normal");
    expect(getCountdownUrgency(120_000)).toBe("normal");
  });
});
