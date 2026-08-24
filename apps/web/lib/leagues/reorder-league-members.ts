import { Prisma, prisma } from "@fdm/database";
import { DraftAlreadyStartedError } from "../drafts/errors";
import { getDraftForLeague } from "../drafts/get-draft-for-league";
import { authorizeLeagueOwner } from "./authorize-commissioner";
import { ReorderConflictError, ReorderMembershipMismatchError } from "./errors";
import type { ReorderLeagueMembersInput } from "./schema";

export interface ReorderLeagueMembersResult {
  members: Array<{
    membershipId: string;
    userId: string;
    name: string;
    image: string | null;
    draftSlot: number;
  }>;
}

function uniqueConstraintTargets(error: unknown): string[] | null {
  if (
    error instanceof Prisma.PrismaClientKnownRequestError &&
    error.code === "P2002" &&
    Array.isArray(error.meta?.target)
  ) {
    return error.meta.target as string[];
  }
  return null;
}

// The client submits the desired FULL order as LeagueMember ids (not
// individual (memberId, draftSlot) patches) precisely so the server can
// derive final slots as 1..N from array position - there's no draftSlot
// field for the client to get wrong, duplicate, or leave non-contiguous.
export async function reorderLeagueMembers(
  leagueId: string,
  input: ReorderLeagueMembersInput,
  requestingUserId: string,
): Promise<ReorderLeagueMembersResult> {
  try {
    const members = await prisma.$transaction(async (tx) => {
      await authorizeLeagueOwner(tx, leagueId, requestingUserId);

      const existingDraft = await getDraftForLeague(tx, leagueId);
      if (existingDraft) {
        throw new DraftAlreadyStartedError();
      }

      const currentMembers = await tx.leagueMember.findMany({
        where: { leagueId },
        select: { id: true },
      });
      const currentIds = new Set(currentMembers.map((m) => m.id));
      const submittedIds = new Set(input.memberIds);

      // The submitted set must be EXACTLY the league's current membership:
      // same size (duplicates within the submission are already rejected at
      // the schema layer) and every id present in both directions. A
      // mismatch here is expected, legitimate behavior when membership
      // changed between the client loading the page and submitting a
      // reorder (e.g. a join landed first under the League row lock) - not
      // a bug.
      if (
        submittedIds.size !== currentIds.size ||
        input.memberIds.some((id) => !currentIds.has(id))
      ) {
        throw new ReorderMembershipMismatchError();
      }

      // Two-phase update avoids ever violating @@unique([leagueId, draftSlot])
      // mid-update: a single-pass update (or even one SQL statement using
      // CASE) can transiently collide - e.g. A:1->2, B:2->1 fails if A is
      // written before B vacates slot 2, because Postgres checks
      // non-deferrable unique constraints per row as each row is written,
      // not deferred to statement end. Negative values in phase one can
      // never collide with any real slot (1..N) or with each other, since
      // each is derived from a distinct array index; phase two's real
      // values likewise can't collide with each other since they're 1..N
      // with no repeats by construction. Both phases run in this one
      // transaction, so a crash between them rolls back to the original
      // order with no visible intermediate state.
      for (let i = 0; i < input.memberIds.length; i++) {
        await tx.leagueMember.update({
          where: { id: input.memberIds[i] },
          data: { draftSlot: -(i + 1) },
        });
      }
      for (let i = 0; i < input.memberIds.length; i++) {
        await tx.leagueMember.update({
          where: { id: input.memberIds[i] },
          data: { draftSlot: i + 1 },
        });
      }

      return tx.leagueMember.findMany({
        where: { leagueId },
        select: {
          id: true,
          userId: true,
          draftSlot: true,
          user: { select: { name: true, image: true } },
        },
        orderBy: { draftSlot: "asc" },
      });
    });

    return {
      members: members.map((member) => ({
        membershipId: member.id,
        userId: member.userId,
        name: member.user.name,
        image: member.user.image,
        draftSlot: member.draftSlot,
      })),
    };
  } catch (error) {
    // Reserved for a (leagueId, draftSlot) unique-constraint hit during the
    // two-phase update above, which should be unreachable given the
    // negative-offset strategy. Mirrors JoinConflictError's role for joins.
    if (uniqueConstraintTargets(error)?.includes("draftSlot")) {
      throw new ReorderConflictError();
    }
    throw error;
  }
}
