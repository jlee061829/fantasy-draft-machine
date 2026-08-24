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
