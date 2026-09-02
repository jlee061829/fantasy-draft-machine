import { Prisma, type DraftStatus, type DraftType } from "../generated/prisma/client.js";
import { prisma } from "../client.js";
import { getPickerForPickNumber } from "@fdm/shared";
import { LeagueNotAccessibleError } from "../leagues/errors.js";
import {
  DraftNotActiveError,
  DraftNotFoundError,
  NotOnTheClockError,
  PickAdvanceInvariantError,
  PlayerAlreadyDraftedError,
  PlayerNotFoundError,
} from "./errors.js";

export interface SubmitPickResult {
  pick: {
    id: string;
    draftId: string;
    pickNumber: number;
    userId: string;
    playerId: string;
    wasAutopick: boolean;
    createdAt: string;
  };
  draft: {
    status: DraftStatus;
    currentPickNumber: number;
    currentUserId: string | null;
    turnDeadline: string | null;
  };
}

// Exported at the module level (not from packages/database/src/index.ts) so
// autopick.ts — the only other caller — can import it directly. index.ts
// deliberately re-exports only submitPick/processExpiredDraftTurn by name
// instead of `export *`-ing this module, and @fdm/database's package.json
// "exports" field exposes no deep-import path to this file, so this stays
// unreachable from apps/web or apps/socket-server regardless of the `export`
// keyword here. See CLAUDE.md's Milestone 3.4 package-boundary decision.
export interface LockedDraft {
  id: string;
  leagueId: string;
  status: DraftStatus;
  currentPickNumber: number;
  currentUserId: string | null;
  turnDeadline: Date | null;
}

export interface DraftProgressionLeagueConfig {
  teamCount: number;
  rosterSize: number;
  draftType: DraftType;
  timerSeconds: number;
}

// Prisma's documented P2002 shape puts the violated columns at
// `error.meta.target`, and that's what every other P2002 handler in this
// codebase (join-league.ts, reorder-league-members.ts, create-league.ts)
// reads. Under this project's actual Prisma 7 + @prisma/adapter-pg setup,
// though, `meta.target` is never populated — the columns instead show up
// at `error.meta.driverAdapterError.cause.constraint.fields`, quoted
// (e.g. `"draftId"`). Checking `target` first keeps this forward-compatible
// with the documented shape should the adapter's error normalization
// change; the driverAdapterError fallback is what actually fires today.
function uniqueConstraintFields(error: unknown): string[] | null {
  if (!(error instanceof Prisma.PrismaClientKnownRequestError) || error.code !== "P2002") {
    return null;
  }
  const meta = error.meta as
    | { target?: unknown; driverAdapterError?: { cause?: { constraint?: { fields?: unknown } } } }
    | undefined;
  if (Array.isArray(meta?.target)) {
    return meta.target as string[];
  }
  const fields = meta?.driverAdapterError?.cause?.constraint?.fields;
  if (Array.isArray(fields)) {
    return fields.map((field) => String(field).replace(/^"|"$/g, ""));
  }
  return null;
}

// Shared by submitPick (manual picks, Milestone 3.2) and processExpiredDraftTurn
// (autopicks, Milestone 3.4) — the single place that locks a League's Draft
// row FOR UPDATE. Both callers serialize on the exact same lock, which is
// what makes a manual-pick-vs-autopick race resolve the same way a
// manual-vs-manual race already does: whichever transaction acquires the
// lock first wins, and the second re-reads post-commit state once it gets
// the lock instead of racing against stale data.
export async function lockDraftForLeague(
  tx: Prisma.TransactionClient,
  leagueId: string,
): Promise<LockedDraft | null> {
  const [draft] = await tx.$queryRaw<LockedDraft[]>`
    SELECT id, "leagueId", status, "currentPickNumber", "currentUserId", "turnDeadline"
    FROM "Draft" WHERE "leagueId" = ${leagueId} FOR UPDATE
  `;
  return draft ?? null;
}

// Shared by submitPick and processExpiredDraftTurn: the actual Pick
// insert + completion/advance write, identical regardless of whether the
// pick was chosen by the requester (manual) or by the autopick selection
// algorithm (timer-triggered). Callers are responsible for everything
// upstream of this — turn-ownership vs. deadline-expiry checks differ
// between the two paths and are deliberately NOT here, so this function
// can't be mistaken for a substitute for either caller's own
// authorization/state checks.
// Exported at the module level for the same reason lockDraftForLeague is
// (see its comment above): autopick.ts needs it, but it must never be
// reachable through @fdm/database's public entry point.
export async function applyPick(
  tx: Prisma.TransactionClient,
  params: {
    draft: LockedDraft;
    league: DraftProgressionLeagueConfig;
    userId: string;
    playerId: string;
    wasAutopick: boolean;
  },
): Promise<SubmitPickResult> {
  const { draft, league, userId, playerId, wasAutopick } = params;

  const player = await tx.player.findUnique({
    where: { id: playerId },
    select: { id: true },
  });
  if (!player) {
    throw new PlayerNotFoundError();
  }

  const alreadyDrafted = await tx.pick.findUnique({
    where: { draftId_playerId: { draftId: draft.id, playerId } },
  });
  if (alreadyDrafted) {
    throw new PlayerAlreadyDraftedError();
  }

  const totalPicks = league.teamCount * league.rosterSize;
  const isFinalPick = draft.currentPickNumber === totalPicks;

  let createdPick;
  try {
    createdPick = await tx.pick.create({
      data: {
        draftId: draft.id,
        pickNumber: draft.currentPickNumber,
        userId,
        playerId,
        wasAutopick,
      },
    });
  } catch (error) {
    const fields = uniqueConstraintFields(error);
    // (draftId, playerId): the same condition the pre-check above already
    // guards against, so it maps to the same domain error.
    if (fields?.includes("draftId") && fields.includes("playerId")) {
      throw new PlayerAlreadyDraftedError();
    }
    // (draftId, pickNumber) should be structurally unreachable under the
    // Draft-row lock (currentPickNumber is only ever read/written inside
    // it) — an unexpected hit here indicates corrupted state, not a
    // legitimate conflict, so it's deliberately left unmapped (500).
    throw error;
  }

  let updatedDraft;
  if (isFinalPick) {
    updatedDraft = await tx.draft.update({
      where: { id: draft.id },
      data: { status: "COMPLETE", currentUserId: null, turnDeadline: null },
    });
  } else {
    const nextPickNumber = draft.currentPickNumber + 1;
    const nextSlot = getPickerForPickNumber(nextPickNumber, league.teamCount, league.draftType);
    const nextPicker = await tx.leagueMember.findUnique({
      where: { leagueId_draftSlot: { leagueId: draft.leagueId, draftSlot: nextSlot } },
    });
    if (!nextPicker) {
      throw new PickAdvanceInvariantError(
        `No LeagueMember at draftSlot ${nextSlot} for league ${draft.leagueId} while advancing to pick ${nextPickNumber}.`,
      );
    }

    const turnDeadline = new Date(Date.now() + league.timerSeconds * 1000);
    updatedDraft = await tx.draft.update({
      where: { id: draft.id },
      data: {
        currentPickNumber: nextPickNumber,
        currentUserId: nextPicker.userId,
        turnDeadline,
      },
    });
  }

  return {
    pick: {
      id: createdPick.id,
      draftId: createdPick.draftId,
      pickNumber: createdPick.pickNumber,
      userId: createdPick.userId,
      playerId: createdPick.playerId,
      wasAutopick: createdPick.wasAutopick,
      createdAt: createdPick.createdAt.toISOString(),
    },
    draft: {
      status: updatedDraft.status,
      currentPickNumber: updatedDraft.currentPickNumber,
      currentUserId: updatedDraft.currentUserId,
      turnDeadline: updatedDraft.turnDeadline?.toISOString() ?? null,
    },
  };
}

// The critical path for manual picks: every requester-supplied Pick is
// written here, and nowhere else. One Prisma interactive transaction,
// sequenced so that the Draft row lock is the single serialization point
// for a turn:
//
//   1. confirm the requester is a current LeagueMember (no lock needed —
//      membership can't change once a Draft exists, since starting a draft
//      already requires memberCount === teamCount and joinLeague's own
//      capacity check makes a later join impossible; see join-league.ts)
//   2. lock the Draft row FOR UPDATE, scoped by leagueId (lockDraftForLeague)
//   3. verify the Draft exists / is ACTIVE / belongs to this requester's turn
//   4. read League config plainly (unlocked) — safe for the same reason as
//      (1): settings/reorder mutations already return 409 once a Draft
//      exists, so nothing left can race a live pick against League config
//   5. delegate player validation + insert + completion/advance to applyPick
//   6. commit
//
// Because the Draft row is locked for the whole transaction, a second
// concurrent submitPick call for the same draft blocks on step 2 until the
// first transaction commits or rolls back. By the time it acquires the
// lock, it re-reads the Draft row's post-commit state — so if the first
// call already advanced currentUserId, the second call fails the turn
// check at step 3 before it ever reaches applyPick. The same lock is what
// serializes submitPick against processExpiredDraftTurn (autopick,
// Milestone 3.4): whichever acquires the Draft row first wins, and the
// loser re-reads and fails its own post-lock check. The
// @@unique([draftId, playerId]) constraint remains the real backstop
// guarantee regardless of whether a given race actually reaches it through
// this path.
export async function submitPick(
  leagueId: string,
  requestingUserId: string,
  playerId: string,
): Promise<SubmitPickResult> {
  return prisma.$transaction(async (tx) => {
    const membership = await tx.leagueMember.findUnique({
      where: { leagueId_userId: { leagueId, userId: requestingUserId } },
    });
    if (!membership) {
      throw new LeagueNotAccessibleError();
    }

    const draft = await lockDraftForLeague(tx, leagueId);
    if (!draft) {
      throw new DraftNotFoundError();
    }
    if (draft.status !== "ACTIVE") {
      throw new DraftNotActiveError();
    }
    if (draft.currentUserId !== requestingUserId) {
      throw new NotOnTheClockError();
    }

    const league = await tx.league.findUniqueOrThrow({
      where: { id: leagueId },
      select: { teamCount: true, rosterSize: true, draftType: true, timerSeconds: true },
    });

    return applyPick(tx, { draft, league, userId: requestingUserId, playerId, wasAutopick: false });
  });
}
