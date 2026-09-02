import type { DraftStateResult } from "@fdm/shared";

// Pure, DOM-free presentation logic for the draft-room shell (Milestone 4.2).
// Every function here derives a display value from the authoritative
// DraftStateResult snapshot (plus, where needed, a caller-supplied "now") —
// none of them read or write any state of their own, so a fresh
// draft:join/draft:state snapshot needs no manual reset/synchronization
// logic anywhere that calls these.

export type DraftPhase = "PENDING" | "ACTIVE" | "COMPLETE";

// Draft creation always starts directly at ACTIVE (Milestone 3.1) and
// DraftStatus.PAUSED remains dormant/unused, so only "no draft yet" and
// "COMPLETE" are reachable non-ACTIVE phases today. A defensive PAUSED/other
// status still falls through to "ACTIVE" rendering rather than crashing —
// there's simply no dedicated presentation for a status the domain doesn't
// currently produce.
export function getDraftPhase(draft: DraftStateResult["draft"]): DraftPhase {
  if (!draft) return "PENDING";
  if (draft.status === "COMPLETE") return "COMPLETE";
  return "ACTIVE";
}

const UNKNOWN_PICKER_NAME = "Unknown manager";

// Returns the display name of whoever is currently on the clock, or null
// when there's no one to display (no Draft yet, or the Draft is COMPLETE
// and currentUserId has been cleared). A currentUserId that doesn't match
// any current member is an unexpected data shape, not a reason to crash the
// draft room — it falls back to a visible placeholder instead.
export function getCurrentPickerName(state: DraftStateResult): string | null {
  const currentUserId = state.draft?.currentUserId;
  if (!currentUserId) return null;

  const member = state.members.find((m) => m.userId === currentUserId);
  return member ? member.name : UNKNOWN_PICKER_NAME;
}

// True only when the authenticated viewer is the exact user the server says
// is on the clock. False whenever there's no Draft, the Draft is COMPLETE
// (currentUserId is null), or someone else is picking.
export function isYourTurn(state: DraftStateResult, currentUserId: string): boolean {
  return state.draft?.currentUserId === currentUserId;
}

// msRemaining is always derived fresh from authoritative turnDeadline and a
// caller-supplied "now" — never decremented or stored. A null deadline
// (no Draft, or Draft complete) has nothing to count down to.
export function getMsRemaining(turnDeadline: string | null, now: number): number {
  if (turnDeadline === null) return 0;
  return Math.max(0, new Date(turnDeadline).getTime() - now);
}

// m:ss, floor-based (never rounds up past the real deadline). Negative input
// is defensively clamped even though getMsRemaining never produces one.
export function formatCountdown(msRemaining: number): string {
  const totalSeconds = Math.floor(Math.max(0, msRemaining) / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${String(seconds).padStart(2, "0")}`;
}
