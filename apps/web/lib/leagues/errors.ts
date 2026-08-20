export class LeagueNotFoundError extends Error {
  constructor() {
    super("No league matches that invite code.");
    this.name = "LeagueNotFoundError";
  }
}

export class AlreadyMemberError extends Error {
  constructor() {
    super("You are already a member of this league.");
    this.name = "AlreadyMemberError";
  }
}

export class LeagueFullError extends Error {
  constructor() {
    super("This league has already reached its team capacity.");
    this.name = "LeagueFullError";
  }
}

// Reserved for the (leagueId, draftSlot) unique-constraint case, which
// should be unreachable under the League row lock + lowest-available-slot
// algorithm in join-league.ts. If it is ever hit, it means something
// unexpected happened during the join, not that the league is full.
export class JoinConflictError extends Error {
  constructor() {
    super("Could not complete the join due to a conflict. Please try again.");
    this.name = "JoinConflictError";
  }
}

// Deliberately collapses "no league with this id" and "authenticated but not
// a member of this league" into one outcome, the same way getLeagueDetail
// does — a non-member shouldn't be able to distinguish those two cases for
// commissioner-mutation endpoints either.
export class LeagueNotAccessibleError extends Error {
  constructor() {
    super("No league matches that id.");
    this.name = "LeagueNotAccessibleError";
  }
}

// Distinguishable from LeagueNotAccessibleError on purpose: a non-owner
// member already has full visibility into the league, so telling them they
// aren't the commissioner leaks nothing new.
export class NotLeagueOwnerError extends Error {
  constructor() {
    super("Only the league commissioner can perform this action.");
    this.name = "NotLeagueOwnerError";
  }
}

// Covers both halves of the teamCount-decrease invariant: the requested
// value must be at least the current member count AND at least the highest
// occupied draft slot (slots can have gaps), so the message is worded to
// cover either violation rather than assuming which one tripped.
export class TeamCountBelowMembershipError extends Error {
  constructor() {
    super(
      "teamCount cannot be lowered below the current member count or the highest occupied draft slot.",
    );
    this.name = "TeamCountBelowMembershipError";
  }
}

// The submitted memberIds must be exactly a permutation of the league's
// current membership. Missing, foreign-league, unknown, or extra ids are all
// the same underlying problem: the submission doesn't match current
// server-side state, which can happen legitimately (e.g. a join landed
// between the client loading the page and submitting a reorder).
export class ReorderMembershipMismatchError extends Error {
  constructor() {
    super("The submitted member order does not match the league's current membership.");
    this.name = "ReorderMembershipMismatchError";
  }
}

// Reserved for a (leagueId, draftSlot) unique-constraint hit during the
// two-phase reorder update, which should be unreachable under the
// negative-offset strategy in reorder-league-members.ts. Mirrors
// JoinConflictError's role for the join path.
export class ReorderConflictError extends Error {
  constructor() {
    super("Could not complete the reorder due to a conflict. Please try again.");
    this.name = "ReorderConflictError";
  }
}
