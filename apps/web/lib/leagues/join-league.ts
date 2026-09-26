import {
  AlreadyMemberError,
  JoinConflictError,
  LeagueFullError,
  LeagueNotFoundError,
  prisma,
  uniqueConstraintFields,
} from "@fdm/database";

export interface JoinLeagueResult {
  league: {
    id: string;
    name: string;
  };
  membership: {
    id: string;
    draftSlot: number;
  };
}

// Mirrors the row-lock pattern the draft engine's pick-submission path will
// use: lock the League row so at most one join transaction per league is
// ever mutating membership at a time. A second concurrent join for the same
// league blocks on the SELECT ... FOR UPDATE until the first transaction
// commits or rolls back, at which point it re-reads a consistent membership
// list under default READ COMMITTED isolation — no SERIALIZABLE/retry
// machinery needed. Joins against different leagues aren't serialized
// against each other since they lock different rows.
export async function joinLeague(
  inviteCode: string,
  userId: string,
): Promise<JoinLeagueResult> {
  try {
    const membership = await prisma.$transaction(async (tx) => {
      const [league] = await tx.$queryRaw<{ id: string; name: string; teamCount: number }[]>`
        SELECT id, name, "teamCount" FROM "League" WHERE "inviteCode" = ${inviteCode} FOR UPDATE
      `;
      if (!league) {
        throw new LeagueNotFoundError();
      }

      const already = await tx.leagueMember.findUnique({
        where: { leagueId_userId: { leagueId: league.id, userId } },
      });
      if (already) {
        throw new AlreadyMemberError();
      }

      const memberships = await tx.leagueMember.findMany({
        where: { leagueId: league.id },
        select: { draftSlot: true },
      });
      if (memberships.length >= league.teamCount) {
        throw new LeagueFullError();
      }

      // Lowest available slot in 1..teamCount, not memberCount + 1 — slots
      // are contiguous today, but this doesn't assume that, so it stays
      // correct once later Phase 2 work can leave gaps (e.g. {1,2,4} -> 3).
      const occupied = new Set(memberships.map((m) => m.draftSlot));
      let draftSlot = 1;
      while (occupied.has(draftSlot)) draftSlot++;

      const created = await tx.leagueMember.create({
        data: { leagueId: league.id, userId, draftSlot },
      });

      return { league, membership: created };
    });

    return {
      league: { id: membership.league.id, name: membership.league.name },
      membership: {
        id: membership.membership.id,
        draftSlot: membership.membership.draftSlot,
      },
    };
  } catch (error) {
    // Phase 6.1: uniqueConstraintFields (packages/database/src/prisma-errors.ts)
    // handles this stack's actual Prisma 7 + @prisma/adapter-pg P2002 shape —
    // meta.target is never populated here, so this previously never fired
    // for a real constraint violation.
    const target = uniqueConstraintFields(error);
    if (target) {
      // Legitimately the same condition the app-level check above already
      // guards against, so it maps to the same domain error.
      if (target.includes("leagueId") && target.includes("userId")) {
        throw new AlreadyMemberError();
      }
      // A draft-slot collision does NOT imply the league is full — under
      // the row lock + lowest-available-slot algorithm above it should be
      // unreachable. Treat it as an unexpected conflict, not capacity.
      if (target.includes("leagueId") && target.includes("draftSlot")) {
        throw new JoinConflictError();
      }
    }
    throw error;
  }
}
