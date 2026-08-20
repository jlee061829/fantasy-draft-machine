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
