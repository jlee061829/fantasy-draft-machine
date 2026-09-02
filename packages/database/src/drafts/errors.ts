// Thrown by startDraft when a League already has a Draft row — covers both
// the app-level check under the League row lock and the Draft.leagueId
// unique-constraint backstop, which represent the same underlying fact.
export class DraftAlreadyExistsError extends Error {
  constructor() {
    super("This league already has a draft.");
    this.name = "DraftAlreadyExistsError";
  }
}

// Starting a draft requires every team slot to be filled by a real member;
// there is no support for empty/autopick-only teams in this milestone.
export class LeagueNotFullError extends Error {
  constructor() {
    super("The league must be completely filled before the draft can start.");
    this.name = "LeagueNotFullError";
  }
}

// Thrown by updateLeagueSettings/reorderLeagueMembers once a Draft exists
// for the league. Distinct from DraftAlreadyExistsError even though both are
// triggered by the same underlying row check — this one describes a
// settings/reorder mutation being locked out, not a duplicate draft-start
// attempt, and the two should read differently in logs/responses.
export class DraftAlreadyStartedError extends Error {
  constructor() {
    super("League settings and draft-slot order cannot be changed after the draft has started.");
    this.name = "DraftAlreadyStartedError";
  }
}

// Thrown by submitPick when the requester is a confirmed LeagueMember of an
// existing league that simply has no Draft yet. Deliberately distinct from
// LeagueNotAccessibleError: membership was already confirmed before this
// check runs, so revealing "no draft yet" leaks nothing to a non-member —
// there's no reason to collapse the two the way LeagueNotAccessibleError
// collapses "nonexistent league" and "non-member".
export class DraftNotFoundError extends Error {
  constructor() {
    super("This league does not have an active draft.");
    this.name = "DraftNotFoundError";
  }
}

// The Draft row exists but its status isn't ACTIVE (e.g. already COMPLETE).
// A state conflict on an accessible resource, not an authorization failure.
export class DraftNotActiveError extends Error {
  constructor() {
    super("This draft is not currently active.");
    this.name = "DraftNotActiveError";
  }
}

// Thrown when the requester is a real LeagueMember but Draft.currentUserId
// belongs to someone else. Deliberately 409, not 403: unlike commissioner
// ownership (a static fact about the league), turn ownership rotates —
// this same user will legitimately become the current picker again later,
// so this reads as a conflict with current draft state rather than a
// standing permissions failure.
export class NotOnTheClockError extends Error {
  constructor() {
    super("It is not currently your turn to pick.");
    this.name = "NotOnTheClockError";
  }
}

// The submitted playerId does not match any Player row.
export class PlayerNotFoundError extends Error {
  constructor() {
    super("No player matches that id.");
    this.name = "PlayerNotFoundError";
  }
}

// Covers both the application-level pre-check and the
// @@unique([draftId, playerId]) backstop, which represent the same
// underlying fact. Under the Draft-row FOR UPDATE lock, a genuine
// concurrent hit on this constraint is expected to be rare in practice —
// the currentUserId turn check upstream is what actually resolves most
// races — but the constraint remains the real guarantee regardless.
export class PlayerAlreadyDraftedError extends Error {
  constructor() {
    super("This player has already been drafted.");
    this.name = "PlayerAlreadyDraftedError";
  }
}

// Reaching this means the LeagueMember occupying the next computed
// draftSlot doesn't exist, despite the league having been full when its
// Draft was started and membership being immutable for the lifetime of an
// ACTIVE draft (no joins/leaves are possible once a Draft exists — see
// join-league.ts's capacity check). Mirrors
// DraftInitializationInvariantError in start-draft.ts: this indicates
// corrupted/impossible server-side state, not a legitimate
// client-triggerable conflict, so it's deliberately NOT one of the domain
// errors the route maps to a 4xx — it's left to propagate as an unhandled
// error (500).
export class PickAdvanceInvariantError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PickAdvanceInvariantError";
  }
}

// Thrown by processExpiredDraftTurn (Milestone 3.4) when neither the
// ADP-based tier nor the searchRank/id fallback tier can find any
// undrafted Player for the format-in-progress. Under this Draft-row lock,
// that means the seeded Player pool is smaller than
// League.teamCount * League.rosterSize — a data/configuration problem, not
// a legitimate runtime conflict. Deliberately NOT one of the domain errors
// mapped to a 4xx/socket error code; the turn-expiry sweep logs it and
// leaves the draft's turnDeadline untouched so the next sweep tick simply
// retries (and will keep failing identically until the underlying player
// pool is fixed).
export class AutopickExhaustedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AutopickExhaustedError";
  }
}
