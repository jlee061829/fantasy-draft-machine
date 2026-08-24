import type { Prisma } from "@fdm/database";

// Must be called inside the caller's transaction, using that transaction's
// `tx` client, after the League row has already been locked (e.g. via
// authorizeLeagueOwner) — so the existence check reflects a consistent,
// serialized view of state. Shared by startDraft (where a hit means
// "already started") and the commissioner settings/reorder services (where
// a hit means "locked out"), since both need the same underlying fact but
// throw different domain errors for it.
export async function getDraftForLeague(
  tx: Prisma.TransactionClient,
  leagueId: string,
): Promise<{ id: string } | null> {
  return tx.draft.findUnique({
    where: { leagueId },
    select: { id: true },
  });
}
