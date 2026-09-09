// Wire/resync DTO shared by every draft-state transport. @fdm/database's
// getDraftState/getDraftStateForLeague build these shapes from Prisma and
// return them; apps/socket-server's realtime resync/broadcast payloads reuse
// the exact same types with no duplication. Deliberately hand-rolled
// string-literal unions rather than the generated Prisma
// DraftStatus/ScoringFormat/DraftType enums, so this package keeps no
// dependency on Prisma or @fdm/database.
export type DraftStateStatus = "PENDING" | "ACTIVE" | "PAUSED" | "COMPLETE";
export type DraftStateScoringFormat = "STANDARD" | "PPR" | "HALF_PPR";
export type DraftStateDraftType = "SNAKE" | "LINEAR";
// Phase 5.1: mirrors the Prisma LeagueMemberType enum as a hand-rolled
// literal union, for the same Prisma-independence reason as the three
// unions above.
export type DraftStateParticipantType = "HUMAN" | "BOT";

export interface DraftStateMember {
  membershipId: string;
  // Phase 5.1: null for a BOT LeagueMember, which has no User row.
  // `participantType` tells a consumer which shape it's looking at;
  // `name`/`image` are already normalized (HUMAN -> user.name/user.image,
  // BOT -> displayName/null) by @fdm/database, so most UI code never needs
  // to branch on participantType itself — see draft-room-helpers.ts and
  // team-roster-helpers.ts.
  participantType: DraftStateParticipantType;
  userId: string | null;
  name: string;
  image: string | null;
  draftSlot: number;
}

export interface DraftStatePick {
  pickNumber: number;
  // Phase 5.1: renamed from userId. Identifies the LeagueMember (HUMAN or
  // BOT) that made the pick — resolve display info via
  // DraftStateResult.members, matching on membershipId.
  leagueMemberId: string;
  playerId: string;
  playerName: string;
  playerPosition: string;
  playerNflTeam: string | null;
  wasAutopick: boolean;
  createdAt: string;
}

export interface DraftStateResult {
  league: {
    id: string;
    name: string;
    rosterSize: number;
    teamCount: number;
    scoringFormat: DraftStateScoringFormat;
    draftType: DraftStateDraftType;
    timerSeconds: number;
  };
  members: DraftStateMember[];
  draft: {
    id: string;
    status: DraftStateStatus;
    currentPickNumber: number;
    // Phase 5.1: renamed from currentUserId. The participant (HUMAN or
    // BOT) currently on the clock, identified by LeagueMember.membershipId
    // — never a User id, since a bot has none. Resolve display info via
    // DraftStateResult.members.
    currentMemberId: string | null;
    turnDeadline: string | null;
  } | null;
  picks: DraftStatePick[];
}
