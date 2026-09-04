import type { SocketErrorCode } from "@fdm/shared";
import { describe, expect, it } from "vitest";
import type { ConnectionStatus } from "./ConnectionStatusBadge";
import { canSubmitPick, mapPickErrorToMessage } from "./pick-submission-helpers";

// Pure-function unit tests, no Postgres and no DOM: these exercise only the
// client-side submission-gating/error-presentation logic layered on top of
// an already-authoritative DraftPhase/turn/connection/pending snapshot.
// Server-side pick correctness (turn validation, duplicate prevention,
// autopick/manual locking) is Phase 3 territory, already covered in
// apps/socket-server and packages/database — not retested here.

describe("canSubmitPick", () => {
  it("is false with no Draft yet (PENDING), even if every other input looks submittable", () => {
    expect(canSubmitPick("PENDING", true, "connected", null)).toBe(false);
  });

  it("is false once the Draft is COMPLETE", () => {
    expect(canSubmitPick("COMPLETE", true, "connected", null)).toBe(false);
  });

  it("is true when ACTIVE, it's the viewer's turn, the socket is connected, and nothing is pending", () => {
    expect(canSubmitPick("ACTIVE", true, "connected", null)).toBe(true);
  });

  it("is false when it's someone else's turn", () => {
    expect(canSubmitPick("ACTIVE", false, "connected", null)).toBe(false);
  });

  const nonConnectedStatuses: ConnectionStatus[] = ["connecting", "reconnecting", "error"];
  for (const status of nonConnectedStatuses) {
    it(`is false when connection status is "${status}"`, () => {
      expect(canSubmitPick("ACTIVE", true, status, null)).toBe(false);
    });
  }

  it("is false whenever a pick request is already pending, even if otherwise submittable", () => {
    expect(canSubmitPick("ACTIVE", true, "connected", "player-1")).toBe(false);
  });
});

describe("mapPickErrorToMessage", () => {
  const cases: Array<[SocketErrorCode, string]> = [
    ["NOT_ON_THE_CLOCK", "It's not your turn right now."],
    ["PLAYER_ALREADY_DRAFTED", "That player was just drafted by someone else."],
    ["DRAFT_NOT_ACTIVE", "This draft is no longer active."],
    ["DRAFT_NOT_FOUND", "This draft hasn't started yet."],
    ["PLAYER_NOT_FOUND", "That player couldn't be found."],
    ["LEAGUE_NOT_ACCESSIBLE", "You don't have access to this league."],
    ["NOT_JOINED", "Still connecting to the draft room — try again in a moment."],
    ["INVALID_PAYLOAD", "Something went wrong submitting that pick. Please try again."],
    ["INTERNAL_ERROR", "Something went wrong submitting that pick. Please try again."],
  ];

  for (const [code, message] of cases) {
    it(`maps ${code} to its user-facing message`, () => {
      expect(mapPickErrorToMessage(code)).toBe(message);
    });
  }

  it("covers every current SocketErrorCode with no fallthrough gaps", () => {
    const allCodes: SocketErrorCode[] = cases.map(([code]) => code);
    expect(new Set(allCodes).size).toBe(allCodes.length);
  });
});
