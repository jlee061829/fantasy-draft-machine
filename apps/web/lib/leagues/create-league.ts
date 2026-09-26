import type { DraftType, ScoringFormat } from "@fdm/database";
import { prisma, uniqueConstraintFields } from "@fdm/database";
import { generateInviteCode } from "./invite-code";
import type { CreateLeagueApiInput } from "./schema";

// Service-level input, distinct from the public HTTP contract
// (CreateLeagueApiInput, parsed from an untrusted request body by
// createLeagueInputSchema). rosterSize is deliberately NOT part of that
// public schema (Milestone 4.5's fixed-15-round product rule — see
// schema.ts's PRODUCT_ROSTER_SIZE), but this service function still accepts
// it explicitly: the route handler always supplies PRODUCT_ROSTER_SIZE for
// real requests, while tests that need a non-15 rosterSize for engine/board
// fixture purposes keep calling this function directly with whatever value
// they need — rosterSize stays fully dynamic at the service/domain/DB layer,
// only the public input boundary is fixed.
export type CreateLeagueInput = CreateLeagueApiInput & { rosterSize: number };

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

// Phase 6.1: uniqueConstraintFields (packages/database/src/prisma-errors.ts)
// handles this stack's actual Prisma 7 + @prisma/adapter-pg P2002 shape —
// meta.target is never populated under this stack, so a check against it
// alone (this function's previous implementation) never actually caught a
// real collision, silently falling through to an unmapped 500 instead of
// retrying.
function isInviteCodeCollision(error: unknown): boolean {
  return uniqueConstraintFields(error)?.includes("inviteCode") ?? false;
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
