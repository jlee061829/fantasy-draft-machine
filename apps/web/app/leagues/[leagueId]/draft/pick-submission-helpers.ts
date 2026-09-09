import type { DraftPickAck, SocketErrorCode } from "@fdm/shared";
import type { ConnectionStatus } from "./ConnectionStatusBadge";
import type { DraftPhase } from "./draft-room-helpers";

// Pure, DOM-free presentation logic for Milestone 4.4's production pick
// submission UX — same pattern as draft-room-helpers.ts: every function
// derives a display value from caller-supplied state and owns none of its
// own, so a fresh authoritative snapshot or connection-status change needs
// no manual reset logic anywhere that calls these.
//
// canSubmitPick is a UX convenience gate only. submitPick (via the Draft
// row's Draft-row lock, Milestone 3.2/3.4) remains the sole correctness
// boundary — the server still validates and can still reject a request this
// function said was fine, e.g. against a client whose authoritative state
// is a moment stale.
export function canSubmitPick(
  phase: DraftPhase,
  isYourTurn: boolean,
  connectionStatus: ConnectionStatus,
  pendingPlayerId: string | null,
): boolean {
  return (
    phase === "ACTIVE" &&
    isYourTurn &&
    connectionStatus === "connected" &&
    pendingPlayerId === null
  );
}

// Record<SocketErrorCode, string> is exhaustive by construction: if a new
// SocketErrorCode is ever added to the shared protocol union, this object
// literal fails to typecheck until a message is added here too, rather than
// silently falling through to a generic message at runtime.
const PICK_ERROR_MESSAGES: Record<SocketErrorCode, string> = {
  NOT_ON_THE_CLOCK: "It's not your turn right now.",
  PLAYER_ALREADY_DRAFTED: "That player was just drafted by someone else.",
  DRAFT_NOT_ACTIVE: "This draft is no longer active.",
  DRAFT_NOT_FOUND: "This draft hasn't started yet.",
  PLAYER_NOT_FOUND: "That player couldn't be found.",
  LEAGUE_NOT_ACCESSIBLE: "You don't have access to this league.",
  NOT_JOINED: "Still connecting to the draft room — try again in a moment.",
  INVALID_PAYLOAD: "Something went wrong submitting that pick. Please try again.",
  INTERNAL_ERROR: "Something went wrong submitting that pick. Please try again.",
};

export function mapPickErrorToMessage(code: SocketErrorCode): string {
  return PICK_ERROR_MESSAGES[code];
}

export type PickAckAction = { type: "resync" } | { type: "error"; message: string };

// Milestone 4.6: the pure decision behind DraftRoomClient's draft:pick ack
// handling. A successful ack ({ok:true}) means the server already committed
// the pick — see draft-pick.ts, whose ack fires only after submitPick
// resolves — so the only thing left to do is pull fresh authoritative state
// (DraftRoomClient does this via a fresh draft:join, not by waiting on the
// room-wide broadcastDraftState, which can fail/be lost after a successful
// commit). A rejection ack maps to the same user-facing message
// mapPickErrorToMessage already produces.
export function getPickAckAction(ack: DraftPickAck): PickAckAction {
  if (ack.ok) return { type: "resync" };
  return { type: "error", message: mapPickErrorToMessage(ack.error) };
}
