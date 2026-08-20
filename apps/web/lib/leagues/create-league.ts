import type { DraftType, ScoringFormat } from "@fdm/database";
import { Prisma, prisma } from "@fdm/database";
import { generateInviteCode } from "./invite-code";
import type { CreateLeagueInput } from "./schema";

export interface CreateLeagueResult {
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
  membership: {
    id: string;
    draftSlot: number;
  };
}

const MAX_INVITE_CODE_ATTEMPTS = 5;

function isInviteCodeCollision(error: unknown): boolean {
  return (
    error instanceof Prisma.PrismaClientKnownRequestError &&
    error.code === "P2002" &&
    Array.isArray(error.meta?.target) &&
    (error.meta.target as string[]).includes("inviteCode")
  );
}

// League creation and the creator's membership must never exist
// independently of each other, so both writes run inside one interactive
// transaction: the second insert needs the freshly generated league.id, and
// if either write fails, Prisma rolls back the whole transaction — no League
// row is left behind without its creator's LeagueMember.
//
// The invite code is generated before the transaction and re-generated on a
// unique-constraint collision rather than assumed collision-free: with an
// 8-character code drawn from a 32-character alphabet the odds are
// negligible, but the DB unique constraint — not the odds — is what actually
// guarantees uniqueness, so a real retry loop backs it up.
export async function createLeague(
  input: CreateLeagueInput,
  ownerId: string,
): Promise<CreateLeagueResult> {
  let attempt = 0;
  while (true) {
    attempt++;
    const inviteCode = generateInviteCode();
    try {
      const { league, membership } = await prisma.$transaction(async (tx) => {
        const league = await tx.league.create({
          data: {
            name: input.name,
            ownerId,
            rosterSize: input.rosterSize,
            teamCount: input.teamCount,
            inviteCode,
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
          teamCount: league.teamCount,
          inviteCode: league.inviteCode,
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
    } catch (error) {
      if (isInviteCodeCollision(error) && attempt < MAX_INVITE_CODE_ATTEMPTS) {
        continue;
      }
      throw error;
    }
  }
}
