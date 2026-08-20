import type { DraftType, ScoringFormat } from "@fdm/database";
import { prisma } from "@fdm/database";
import { authorizeLeagueOwner } from "./authorize-commissioner";
import { TeamCountBelowMembershipError } from "./errors";
import type { UpdateLeagueSettingsInput } from "./schema";

export interface UpdateLeagueSettingsResult {
  league: {
    id: string;
    name: string;
    ownerId: string;
    rosterSize: number;
    teamCount: number;
    inviteCode: string;
    timerSeconds: number;
    scoringFormat: ScoringFormat;
    draftType: DraftType;
    createdAt: string;
  };
}

export async function updateLeagueSettings(
  leagueId: string,
  input: UpdateLeagueSettingsInput,
  requestingUserId: string,
): Promise<UpdateLeagueSettingsResult> {
  const league = await prisma.$transaction(async (tx) => {
    await authorizeLeagueOwner(tx, leagueId, requestingUserId);

    if (input.teamCount !== undefined) {
      // A decrease is unsafe unless it stays at or above BOTH the current
      // member count and the highest occupied draft slot. Member count alone
      // isn't enough: slots can have gaps (e.g. {1,2,4} with only 3
      // members), so teamCount=3 must still be rejected there even though
      // 3 >= memberCount(3) - slot 4 would become invalid for a 3-team
      // league. This never auto-compacts/reorders slots as a side effect;
      // that stays reorder's job in a separate transaction.
      const memberships = await tx.leagueMember.findMany({
        where: { leagueId },
        select: { draftSlot: true },
      });
      const memberCount = memberships.length;
      const highestOccupiedSlot = memberships.reduce(
        (max, m) => Math.max(max, m.draftSlot),
        0,
      );
      if (input.teamCount < memberCount || input.teamCount < highestOccupiedSlot) {
        throw new TeamCountBelowMembershipError();
      }
    }

    return tx.league.update({
      where: { id: leagueId },
      data: {
        ...(input.name !== undefined && { name: input.name }),
        ...(input.rosterSize !== undefined && { rosterSize: input.rosterSize }),
        ...(input.teamCount !== undefined && { teamCount: input.teamCount }),
        ...(input.timerSeconds !== undefined && { timerSeconds: input.timerSeconds }),
        ...(input.scoringFormat !== undefined && { scoringFormat: input.scoringFormat }),
        ...(input.draftType !== undefined && { draftType: input.draftType }),
      },
    });
  });

  return {
    league: {
      id: league.id,
      name: league.name,
      ownerId: league.ownerId,
      rosterSize: league.rosterSize,
      teamCount: league.teamCount,
      inviteCode: league.inviteCode,
      timerSeconds: league.timerSeconds,
      scoringFormat: league.scoringFormat,
      draftType: league.draftType,
      createdAt: league.createdAt.toISOString(),
    },
  };
}
