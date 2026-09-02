import type { DraftType, ScoringFormat } from "@fdm/database";
import { prisma } from "@fdm/database";

export interface LeagueDetailResult {
  league: {
    id: string;
    name: string;
    ownerId: string;
    rosterSize: number;
    teamCount: number;
    timerSeconds: number;
    scoringFormat: ScoringFormat;
    draftType: DraftType;
    inviteCode: string;
    createdAt: string;
  };
  owner: {
    id: string;
    name: string;
    image: string | null;
  };
  members: Array<{
    membershipId: string;
    userId: string;
    name: string;
    image: string | null;
    draftSlot: number;
  }>;
  // Existence only — the page's only question is whether to render a
  // start-draft control or a link into the draft room. Widen this (e.g. to
  // include `status`) only when a later milestone actually needs more than
  // existence, per the Milestone 4.1 DTO-minimality decision.
  draft: { id: string } | null;
}

// Membership is enforced as part of the query predicate itself — `where`
// requires a member row for `requestingUserId` to exist — rather than
// fetched-then-checked in application code. This means a nonexistent league
// and an existing league the requester isn't a member of both fail the same
// `where` clause and return `null` from the same code path, which is the
// point: the two cases are meant to be indistinguishable to the caller so
// non-members can't use this to enumerate real league IDs.
//
// `findFirst` (not `findUnique`) because the predicate combines `id` with a
// relation filter (`members: { some }`), not a bare unique-field lookup.
// The `include.members` below is a separate, unfiltered relation load, so
// the full authorized member list still comes back in this one query.
export async function getLeagueDetail(
  leagueId: string,
  requestingUserId: string,
): Promise<LeagueDetailResult | null> {
  const league = await prisma.league.findFirst({
    where: {
      id: leagueId,
      members: { some: { userId: requestingUserId } },
    },
    include: {
      owner: { select: { id: true, name: true, image: true } },
      members: {
        select: {
          id: true,
          userId: true,
          draftSlot: true,
          user: { select: { id: true, name: true, image: true } },
        },
        orderBy: { draftSlot: "asc" },
      },
      draft: { select: { id: true } },
    },
  });

  if (!league) {
    return null;
  }

  return {
    league: {
      id: league.id,
      name: league.name,
      ownerId: league.ownerId,
      rosterSize: league.rosterSize,
      teamCount: league.teamCount,
      timerSeconds: league.timerSeconds,
      scoringFormat: league.scoringFormat,
      draftType: league.draftType,
      inviteCode: league.inviteCode,
      createdAt: league.createdAt.toISOString(),
    },
    owner: {
      id: league.owner.id,
      name: league.owner.name,
      image: league.owner.image,
    },
    members: league.members.map((member) => ({
      membershipId: member.id,
      userId: member.userId,
      name: member.user.name,
      image: member.user.image,
      draftSlot: member.draftSlot,
    })),
    draft: league.draft ? { id: league.draft.id } : null,
  };
}
