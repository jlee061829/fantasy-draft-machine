// Phase 5.6: universal, strategy-neutral hard roster-composition rules for
// BOT drafting. "Onesie" positions (QB/TE/K/DEF) get hard caps rather than
// soft penalties — see CLAUDE.md's Phase 5.6 notes (once written) for the
// full rationale. K/DEF get an absolute max of 1 (no soft duplicate
// penalty survives this milestone); QB/TE get an absolute max of 2, with
// the second copy gated behind an "elite first pick + late backup window"
// rule rather than open depth.
//
// Every one of these thresholds is >= the corresponding
// STARTING_LINEUP_REQUIREMENTS minimum (K1/DEF1/QB1/TE1), so a hard cap can
// never itself prevent a BOT from reaching its required minimum at that
// position — caps only ever remove *surplus* copies the starting lineup
// never needed. This is why onesie filtering can run unconditionally,
// before lineup-feasibility filtering, with no risk of the two rules
// fighting each other.
//
// No strategy parameter exists anywhere in this file — BALANCED, RB_HEAVY,
// WR_HEAVY, and HERO_RB all call the exact same functions with no way to
// vary the outcome. Strategy only ever touches RB/WR penalty scoring,
// applied later and only among candidates that already survive this filter.
export const ONESIE_MAX = { K: 1, DEF: 1, QB: 2, TE: 2 } as const;

export const ELITE_QB_RANK_THRESHOLD = 8;
export const ELITE_TE_RANK_THRESHOLD = 5;

// backupWindowStart = max(1, rosterSize - 5); for the product default
// rosterSize=15 this is round 10 (rounds 1-9 closed, 10-15 open).
export function getBackupWindowStart(rosterSize: number): number {
  return Math.max(1, rosterSize - 5);
}

export function isBackupWindowOpen(roundNumber: number, rosterSize: number): boolean {
  return roundNumber >= getBackupWindowStart(rosterSize);
}

// A player with no usable ADP row for the league's scoring format has
// positionalRank === null; per the frozen design, an unranked owned
// QB/TE is treated as non-elite (an unranked player should never block a
// legitimate late upside backup). `rank <= threshold` is the only elite
// case, so `null` naturally falls through to "not elite" with no separate
// branch needed.
function isElite(positionalRank: number | null, threshold: number): boolean {
  return positionalRank !== null && positionalRank <= threshold;
}

export interface OnesieEligibilityParams {
  position: string;
  ownedCounts: Record<string, number>;
  // Only consulted when ownedCounts.QB === 1 / ownedCounts.TE === 1
  // respectively; pass null in every other case (the value is never read).
  ownedQbPositionalRank: number | null;
  ownedTePositionalRank: number | null;
  roundNumber: number;
  rosterSize: number;
}

// Pure, hard eligibility filter — returns false to mean "remove this
// candidate from the pool entirely," never "penalize it." Called once per
// raw candidate, before lineup-feasibility filtering and before strategy
// scoring (see the frozen selector pipeline).
export function isCandidateOnesieEligible(params: OnesieEligibilityParams): boolean {
  const { position, ownedCounts, ownedQbPositionalRank, ownedTePositionalRank, roundNumber, rosterSize } = params;
  const owned = (pos: string): number => ownedCounts[pos] ?? 0;

  switch (position) {
    case "K":
      return owned("K") < ONESIE_MAX.K;
    case "DEF":
      return owned("DEF") < ONESIE_MAX.DEF;
    case "QB": {
      const n = owned("QB");
      if (n === 0) return true;
      if (n === 1) {
        const qb1Elite = isElite(ownedQbPositionalRank, ELITE_QB_RANK_THRESHOLD);
        return isBackupWindowOpen(roundNumber, rosterSize) && !qb1Elite;
      }
      return false; // 2+
    }
    case "TE": {
      const n = owned("TE");
      if (n === 0) return true;
      if (n === 1) {
        const te1Elite = isElite(ownedTePositionalRank, ELITE_TE_RANK_THRESHOLD);
        return isBackupWindowOpen(roundNumber, rosterSize) && !te1Elite;
      }
      return false; // 2+
    }
    default:
      // RB/WR/unrecognized: no onesie restriction.
      return true;
  }
}
