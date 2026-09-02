import type { DraftType, ScoringFormat } from "@fdm/database";
import { prisma } from "@fdm/database";

export interface MyLeagueSummary {
  id: string;
  name: string;
  ownerId: string;
  teamCount: number;
  scoringFormat: ScoringFormat;
  draftType: DraftType;
}

// Membership, not ownership, is the source of truth for "leagues this user
// participates in" — querying LeagueMember naturally includes leagues the
// user created (the creator always receives a LeagueMember row at slot 1;
// see createLeague) alongside leagues they joined via invite code, with no
// need to union a separate ownerId query.
export async function getMyLeagues(userId: string): Promise<MyLeagueSummary[]> {
  const memberships = await prisma.leagueMember.findMany({
    where: { userId },
    include: {
      league: {
        select: {
          id: true,
          name: true,
          ownerId: true,
          teamCount: true,
          scoringFormat: true,
          draftType: true,
          createdAt: true,
        },
      },
    },
    orderBy: { league: { createdAt: "desc" } },
  });

  return memberships.map(({ league }) => ({
    id: league.id,
    name: league.name,
    ownerId: league.ownerId,
    teamCount: league.teamCount,
    scoringFormat: league.scoringFormat,
    draftType: league.draftType,
  }));
}
