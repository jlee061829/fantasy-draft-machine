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

export interface DraftStateMember {
  membershipId: string;
  userId: string;
  name: string;
  image: string | null;
  draftSlot: number;
}

export interface DraftStatePick {
  pickNumber: number;
  userId: string;
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
    currentUserId: string | null;
    turnDeadline: string | null;
  } | null;
  picks: DraftStatePick[];
}
