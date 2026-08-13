import type { DraftType, ScoringFormat } from "@fdm/database";
import { prisma } from "@fdm/database";
import type { CreateLeagueInput } from "./schema";

export interface CreateLeagueResult {
  league: {
    id: string;
    name: string;
    ownerId: string;
    rosterSize: number;
    timerSeconds: number;
    scoringFormat: ScoringFormat;
    draftType: DraftType;
    createdAt: string;
  };
  membership: {
    id: string;
    draftSlot: number;
  };
}

// League creation and the creator's membership must never exist
// independently of each other, so both writes run inside one interactive
// transaction: the second insert needs the freshly generated league.id, and
// if either write fails, Prisma rolls back the whole transaction — no League
// row is left behind without its creator's LeagueMember.
export async function createLeague(
  input: CreateLeagueInput,
  ownerId: string,
): Promise<CreateLeagueResult> {
  const { league, membership } = await prisma.$transaction(async (tx) => {
    const league = await tx.league.create({
      data: {
        name: input.name,
        ownerId,
        rosterSize: input.rosterSize,
        timerSeconds: input.timerSeconds,
        scoringFormat: input.scoringFormat,
        draftType: input.draftType,
      },
    });

    const membership = await tx.leagueMember.create({
      data: {
        leagueId: league.id,
        userId: ownerId,
        draftSlot: 1,
      },
    });

    return { league, membership };
  });

  return {
    league: {
      id: league.id,
      name: league.name,
      ownerId: league.ownerId,
      rosterSize: league.rosterSize,
      timerSeconds: league.timerSeconds,
      scoringFormat: league.scoringFormat,
      draftType: league.draftType,
      createdAt: league.createdAt.toISOString(),
    },
    membership: {
      id: membership.id,
      draftSlot: membership.draftSlot,
    },
  };
}
