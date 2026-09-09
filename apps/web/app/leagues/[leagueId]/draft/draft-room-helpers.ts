import type { DraftStateResult } from "@fdm/shared";
import { getRoundForPick } from "./draft-board-helpers";

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
// and currentMemberId has been cleared). A currentMemberId that doesn't
// match any current member is an unexpected data shape, not a reason to
// crash the draft room — it falls back to a visible placeholder instead.
//
// Phase 5.1: matches on membershipId, not userId — the picker on the clock
// is a LeagueMember (HUMAN or BOT), and `member.name` is already the
// normalized display name for either shape (see @fdm/database's
// getDraftState), so no HUMAN/BOT branching is needed here.
export function getCurrentPickerName(state: DraftStateResult): string | null {
  const currentMemberId = state.draft?.currentMemberId;
  if (!currentMemberId) return null;

  const member = state.members.find((m) => m.membershipId === currentMemberId);
  return member ? member.name : UNKNOWN_PICKER_NAME;
}

// True only when the authenticated viewer is the exact participant the
// server says is on the clock. False whenever there's no Draft, the Draft
// is COMPLETE (currentMemberId is null), someone else is picking, or the
// current picker is a BOT (a BOT's userId is always null, so it can never
// equal any real viewer's id below).
//
// Phase 5.1: two distinct identities are involved on purpose — viewerUserId
// is the authenticated browser user (a real User.id), while the picker is
// tracked by membership identity (currentMemberId). This resolves the
// viewer's own membership row first, then compares membership-to-membership
// rather than comparing a User.id to a value that might be a bot's
// membership id.
export function isYourTurn(state: DraftStateResult, viewerUserId: string): boolean {
  const currentMemberId = state.draft?.currentMemberId;
  if (!currentMemberId) return false;

  const viewerMembership = state.members.find((m) => m.userId === viewerUserId);
  return viewerMembership?.membershipId === currentMemberId;
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

// The single source of drafted-player identity for Milestone 4.3's
// available-players panel — derived fresh from authoritative state.picks on
// every render rather than tracked as a second mutable "draftedPlayers"
// collection. A new draft:state/draft:join snapshot (manual pick, autopick,
// or resync) is reflected automatically the next time this is called.
export function getDraftedPlayerIds(state: DraftStateResult): Set<string> {
  return new Set(state.picks.map((pick) => pick.playerId));
}

export interface RoundInfo {
  round: number;
  totalRounds: number;
  pickNumber: number;
}

// Milestone 4.6: derived round/pick context for TurnBanner ("Round 4 of 15 ·
// Pick 39 overall"). null whenever there's no in-progress pick to describe
// (no Draft yet, or COMPLETE) — mirrors getDraftPhase's own "anything
// non-COMPLETE and non-null counts as in-progress" defensive treatment
// rather than requiring status === "ACTIVE" literally.
export function getRoundInfo(state: DraftStateResult): RoundInfo | null {
  const draft = state.draft;
  if (!draft || draft.status === "COMPLETE") return null;
  return {
    round: getRoundForPick(draft.currentPickNumber, state.league.teamCount),
    totalRounds: state.league.rosterSize,
    pickNumber: draft.currentPickNumber,
  };
}

export type CountdownUrgency = "normal" | "warning" | "critical";

// Presentation only — never changes what formatCountdown displays (still
// floors/clamps at 0 exactly as before), only how it's colored. Thresholds
// are arbitrary but ordered so "critical" always includes 0.
export function getCountdownUrgency(msRemaining: number): CountdownUrgency {
  if (msRemaining <= 5_000) return "critical";
  if (msRemaining <= 15_000) return "warning";
  return "normal";
}
