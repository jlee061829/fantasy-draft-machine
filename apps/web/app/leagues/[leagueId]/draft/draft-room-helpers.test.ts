import type { DraftStateResult } from "@fdm/shared";
import { describe, expect, it } from "vitest";
import {
  formatCountdown,
  getCurrentPickerName,
  getDraftPhase,
  getMsRemaining,
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

const members: DraftStateResult["members"] = [
  { membershipId: "m1", userId: "user-1", name: "Alice", image: null, draftSlot: 1 },
  { membershipId: "m2", userId: "user-2", name: "Bob", image: null, draftSlot: 2 },
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
        currentUserId: "user-1",
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
        currentUserId: null,
        turnDeadline: null,
      }),
    ).toBe("COMPLETE");
  });
});

describe("getCurrentPickerName", () => {
  it("returns null when there is no Draft", () => {
    expect(getCurrentPickerName(stateWithDraft(null))).toBeNull();
  });

  it("returns null when the Draft is complete (currentUserId cleared)", () => {
    const state = stateWithDraft({
      id: "d1",
      status: "COMPLETE",
      currentPickNumber: 64,
      currentUserId: null,
      turnDeadline: null,
    });
    expect(getCurrentPickerName(state)).toBeNull();
  });

  it("returns the matching member's name", () => {
    const state = stateWithDraft({
      id: "d1",
      status: "ACTIVE",
      currentPickNumber: 1,
      currentUserId: "user-2",
      turnDeadline: null,
    });
    expect(getCurrentPickerName(state)).toBe("Bob");
  });

  it("falls back to a safe placeholder for an unmatched currentUserId", () => {
    const state = stateWithDraft({
      id: "d1",
      status: "ACTIVE",
      currentPickNumber: 1,
      currentUserId: "some-other-user",
      turnDeadline: null,
    });
    expect(getCurrentPickerName(state)).toBe("Unknown manager");
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
      currentUserId: null,
      turnDeadline: null,
    });
    expect(isYourTurn(state, "user-1")).toBe(false);
  });

  it("is true only for the current picker", () => {
    const state = stateWithDraft({
      id: "d1",
      status: "ACTIVE",
      currentPickNumber: 1,
      currentUserId: "user-1",
      turnDeadline: null,
    });
    expect(isYourTurn(state, "user-1")).toBe(true);
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
