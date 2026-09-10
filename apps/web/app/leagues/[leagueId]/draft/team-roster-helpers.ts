import type { DraftStateResult } from "@fdm/shared";

// Milestone 4.5: one member per League, in state.members' existing
// draftSlot-ascending order (never re-sorted here), each holding that
// member's own picks in the array's existing pickNumber-ascending order.
// Derived fresh from DraftStateResult on every call — no second mutable
// roster collection anywhere, so a fresh draft:state/draft:join snapshot is
// reflected automatically wherever this is called from useMemo.
//
// Phase 5.1: grouping key is membershipId, not userId — a BOT member has
// no userId to group by. `userId`/`name` are kept here for display
// purposes (`name` is already HUMAN/BOT-normalized by @fdm/database).
//
// Phase 5.4: also carries participantType, so TeamRosterPanel can render a
// lightweight "(BOT)" marker in its roster selector — presentation only,
// derived straight from the already-normalized member data with no new
// query or branching logic.
export interface TeamRoster {
  membershipId: string;
  participantType: "HUMAN" | "BOT";
  userId: string | null;
  name: string;
  draftSlot: number;
  picks: DraftStateResult["picks"];
}

export function deriveTeamRosters(state: DraftStateResult): TeamRoster[] {
  return state.members.map((member) => ({
    membershipId: member.membershipId,
    participantType: member.participantType,
    userId: member.userId,
    name: member.name,
    draftSlot: member.draftSlot,
    picks: state.picks.filter((pick) => pick.leagueMemberId === member.membershipId),
  }));
}
