import type { Prisma, ScoringFormat } from "../generated/prisma/client.js";

// Extracted from autopick.ts in Phase 5.2. This is the one player-ranking
// primitive shared by every automated pick source: today, human
// timer-expiry autopick (processExpiredDraftTurn); later, Phase 5.3's
// server-side BOT turn orchestrator, which will call this same function
// under its own locked transaction rather than duplicating the ranking
// rules. The two callers pick players for different *reasons* (a human's
// deadline elapsed vs. a bot's turn arrived), but the underlying question —
// "given the current draft state, who is the best available player?" — is
// identical, so there is exactly one implementation of it.
//
// This function is read-only and owns no draft correctness by itself. It
// does not lock anything, does not check turn ownership, and does not
// write a Pick. Callers are responsible for running it inside the same
// locked transaction (via lockDraftForLeague) that will go on to call
// applyPick with the returned playerId — see processExpiredDraftTurn in
// autopick.ts for the reference sequence. A playerId selected outside that
// lock (e.g. for a hypothetical "preview" use) must never be fed into
// applyPick later without re-selecting inside the real transaction: the
// draft's undrafted-player set can change between an unlocked read and a
// later locked write.
//
// Eligibility (Phase 5.2 correction): candidates are restricted to rostered
// players (Player.nflTeam IS NOT NULL), matching the Phase 4.3 Available
// Players UI pool (apps/web/lib/players/get-available-players.ts). Before
// this milestone, automated selection (then private to autopick.ts) had no
// such restriction and could in principle select a player a human could
// never see or choose in the Available Players panel. There is now exactly
// one rostered-eligibility rule, applied identically to manual UI discovery
// and automated selection — not two independently-maintained definitions.
//
// Tier 1: lowest ADP for the league's scoring format, among undrafted
// rostered players with a non-null ADP row for that format.
//   ORDER BY adp ASC, searchRank ASC NULLS LAST, id ASC
// searchRank and id are tiebreaks for an exact ADP tie — previously (as
// private selectAutopickPlayerId) tier 1 had no tiebreak at all, so an
// exact ADP tie's winner was whatever Postgres/Prisma happened to return
// first, not a documented guarantee. Both tiebreaks are now explicit.
//
// Tier 2 (fallback): only reached when no undrafted rostered player has a
// non-null ADP row for this format at all. Ranks the same rostered/undrafted
// candidate set by searchRank, nulls last, with id as the final
// fully-deterministic tiebreak. This tier's ordering is unchanged from the
// pre-5.2 implementation.
//
// Returns null when no eligible undrafted rostered player exists in either
// tier. This function never throws for "no player found" — that is an
// ordinary, expected outcome of a draft-scoped, pool-scoped query, and each
// caller defines what null means for its own context (today:
// processExpiredDraftTurn treats it as AutopickExhaustedError, an internal
// invariant failure; a future bot caller may define its own semantics).
export async function selectBestAvailablePlayerId(
  tx: Prisma.TransactionClient,
  params: { draftId: string; scoringFormat: ScoringFormat },
): Promise<string | null> {
  const { draftId, scoringFormat } = params;

  const topByAdp = await tx.playerAdp.findFirst({
    where: {
      format: scoringFormat,
      adp: { not: null },
      player: {
        nflTeam: { not: null },
        picks: { none: { draftId } },
      },
    },
    orderBy: [
      { adp: "asc" },
      { player: { searchRank: { sort: "asc", nulls: "last" } } },
      { player: { id: "asc" } },
    ],
    select: { playerId: true },
  });
  if (topByAdp) {
    return topByAdp.playerId;
  }

  const topBySearchRank = await tx.player.findFirst({
    where: {
      nflTeam: { not: null },
      picks: { none: { draftId } },
    },
    orderBy: [{ searchRank: { sort: "asc", nulls: "last" } }, { id: "asc" }],
    select: { id: true },
  });
  return topBySearchRank?.id ?? null;
}
