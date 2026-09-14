// Phase 5.6: the fixed, non-configurable starting-lineup shape every BOT
// drafts toward. This is a BOT drafting-domain rule, not a league-level
// schema/configuration concept — there is no per-league lineup setting
// anywhere in the product, and this milestone deliberately does not add
// one. Persistence-independent by design (no Prisma dependency), matching
// the same tier as pick-order.ts's getPickerForPickNumber.
export const STARTING_LINEUP_REQUIREMENTS = {
  QB: 1,
  RB: 2,
  WR: 2,
  TE: 1,
  K: 1,
  DEF: 1,
} as const;

// The single FLEX slot draws from these three positions only — K/DEF never
// count toward it. With exactly one FLEX slot, "can FLEX be filled" reduces
// to "does any surplus exist across RB/WR/TE combined" — no matching/flow
// algorithm is needed (see getMissingStartingLineupSlots below).
export const FLEX_ELIGIBLE_POSITIONS = ["RB", "WR", "TE"] as const;
export const FLEX_SLOTS = 1;

export const STARTING_LINEUP_TOTAL =
  Object.values(STARTING_LINEUP_REQUIREMENTS).reduce((sum, n) => sum + n, 0) + FLEX_SLOTS; // 9

export interface MissingLineupSlots {
  QB: number;
  RB: number;
  WR: number;
  TE: number;
  K: number;
  DEF: number;
  FLEX: number;
  total: number;
}

// Pure. Positions absent from `counts` are treated as 0 — this also makes
// an unrecognized position key in `counts` (there shouldn't be one, but
// this function never assumes) simply ignored rather than throwing.
export function getMissingStartingLineupSlots(counts: Record<string, number>): MissingLineupSlots {
  const owned = (position: string): number => counts[position] ?? 0;
  const req = STARTING_LINEUP_REQUIREMENTS;

  const missingQB = Math.max(0, req.QB - owned("QB"));
  const missingRB = Math.max(0, req.RB - owned("RB"));
  const missingWR = Math.max(0, req.WR - owned("WR"));
  const missingTE = Math.max(0, req.TE - owned("TE"));
  const missingK = Math.max(0, req.K - owned("K"));
  const missingDEF = Math.max(0, req.DEF - owned("DEF"));

  const flexSurplus =
    Math.max(0, owned("RB") - req.RB) + Math.max(0, owned("WR") - req.WR) + Math.max(0, owned("TE") - req.TE);
  const missingFlex = Math.max(0, FLEX_SLOTS - flexSurplus);

  const total = missingQB + missingRB + missingWR + missingTE + missingK + missingDEF + missingFlex;

  return { QB: missingQB, RB: missingRB, WR: missingWR, TE: missingTE, K: missingK, DEF: missingDEF, FLEX: missingFlex, total };
}

export function canFieldStartingLineup(counts: Record<string, number>): boolean {
  return getMissingStartingLineupSlots(counts).total === 0;
}

// The one hard BOT-strategy rule (Phase 5.6): a candidate is lineup-feasible
// only if, after hypothetically adding it, the BOT's remaining picks are
// still enough to cover whatever starting-lineup slots would still be
// missing. `remainingPicksIncludingThisOne` is the BOT's total remaining
// picks in this draft counting the pick about to be made (i.e.
// `rosterSize - picksAlreadyMade`), so `remainingAfter` below is that value
// minus 1.
//
// This never inspects whether a real candidate of the missing position
// still exists in the undrafted pool — it is pure picks-count-vs-missing-
// slots arithmetic. Supply-level exhaustion (e.g. every DEF already gone)
// is handled by the caller's impossible-lineup fallback, not by this
// function returning something different.
export function wouldSelectionPreserveLineupFeasibility(
  currentCounts: Record<string, number>,
  candidatePosition: string,
  remainingPicksIncludingThisOne: number,
): boolean {
  const hypothetical = {
    ...currentCounts,
    [candidatePosition]: (currentCounts[candidatePosition] ?? 0) + 1,
  };
  const missingAfter = getMissingStartingLineupSlots(hypothetical).total;
  const remainingAfter = remainingPicksIncludingThisOne - 1;
  return remainingAfter >= missingAfter;
}
