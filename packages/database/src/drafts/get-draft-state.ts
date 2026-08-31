import { prisma } from "../client.js";
import type { Prisma } from "../generated/prisma/client.js";

// The DraftStateResult DTO shape (and its member/pick/status/format/type
// unions) lives in @fdm/shared, not here: it's the wire/resync contract both
// apps/web and apps/socket-server consume, and keeping the type definition
// in the persistence-independent shared package lets the socket transport
// import it without depending on Prisma or this package. This module keeps
// every Prisma select/query/mapping concern — the DTO is only ever built
// here, from the two query functions below. Re-exported so existing
// importers of these types from "@fdm/database" are unaffected.
import type {
  DraftStateResult,
  DraftStateMember,
  DraftStatePick,
  DraftStateStatus,
  DraftStateScoringFormat,
  DraftStateDraftType,
} from "@fdm/shared";
export type {
  DraftStateResult,
  DraftStateMember,
  DraftStatePick,
  DraftStateStatus,
  DraftStateScoringFormat,
  DraftStateDraftType,
};

// Single field-selection shared by both query variants below, so the
// membership-checked (getDraftState) and unchecked (getDraftStateForLeague)
// paths can't drift out of sync with each other over time.
const draftStateSelect = {
  id: true,
  name: true,
  rosterSize: true,
  teamCount: true,
  scoringFormat: true,
  draftType: true,
  timerSeconds: true,
  members: {
    select: {
      id: true,
      userId: true,
      draftSlot: true,
      user: { select: { id: true, name: true, image: true } },
    },
    orderBy: { draftSlot: "asc" },
  },
  draft: {
    select: {
      id: true,
      status: true,
      currentPickNumber: true,
      currentUserId: true,
      turnDeadline: true,
      picks: {
        orderBy: { pickNumber: "asc" },
        select: {
          pickNumber: true,
          userId: true,
          playerId: true,
          wasAutopick: true,
          createdAt: true,
          player: { select: { fullName: true, position: true, nflTeam: true } },
        },
      },
    },
  },
} satisfies Prisma.LeagueSelect;

type RawDraftState = Prisma.LeagueGetPayload<{ select: typeof draftStateSelect }>;

function toDraftStateResult(league: RawDraftState): DraftStateResult {
  return {
    league: {
      id: league.id,
      name: league.name,
      rosterSize: league.rosterSize,
      teamCount: league.teamCount,
      scoringFormat: league.scoringFormat,
      draftType: league.draftType,
      timerSeconds: league.timerSeconds,
    },
    members: league.members.map((member) => ({
      membershipId: member.id,
      userId: member.userId,
      name: member.user.name,
      image: member.user.image,
      draftSlot: member.draftSlot,
    })),
    draft: league.draft
      ? {
          id: league.draft.id,
          status: league.draft.status,
          currentPickNumber: league.draft.currentPickNumber,
          currentUserId: league.draft.currentUserId,
          turnDeadline: league.draft.turnDeadline?.toISOString() ?? null,
        }
      : null,
    picks: (league.draft?.picks ?? []).map((pick) => ({
      pickNumber: pick.pickNumber,
      userId: pick.userId,
      playerId: pick.playerId,
      playerName: pick.player.fullName,
      playerPosition: pick.player.position,
      playerNflTeam: pick.player.nflTeam,
      wasAutopick: pick.wasAutopick,
      createdAt: pick.createdAt.toISOString(),
    })),
  };
}

// No authorization check — trusts the caller. Only for server-internal use
// (e.g. rebuilding a broadcast payload after a mutation already authorized
// and applied by submitPick), never exposed directly to a route/handler
// without an auth check wrapping it. Kept separate from getDraftState below
// so the common (authorized) path doesn't pay for an extra round trip.
export async function getDraftStateForLeague(leagueId: string): Promise<DraftStateResult | null> {
  const league = await prisma.league.findUnique({
    where: { id: leagueId },
    select: draftStateSelect,
  });
  return league ? toDraftStateResult(league) : null;
}

// Membership is enforced as part of the query predicate itself, the same
// way getLeagueDetail does — a nonexistent league and an existing league the
// requester isn't a member of both fail the same `where` clause and return
// `null` from the same code path, so a non-member can't distinguish the two.
export async function getDraftState(
  leagueId: string,
  requestingUserId: string,
): Promise<DraftStateResult | null> {
  const league = await prisma.league.findFirst({
    where: { id: leagueId, members: { some: { userId: requestingUserId } } },
    select: draftStateSelect,
  });
  return league ? toDraftStateResult(league) : null;
}
