// Phase 5.6: BOT strategy variants. Hand-rolled string-literal union rather
// than importing the generated Prisma BotStrategy enum, for the same
// Prisma-independence reason as DraftStateParticipantType etc. — Prisma's
// enum ("BALANCED" | "RB_HEAVY" | "WR_HEAVY" | "HERO_RB" underneath) remains
// structurally assignable here with no conversion.
export type BotStrategy = "BALANCED" | "RB_HEAVY" | "WR_HEAVY" | "HERO_RB";

// Deterministic assignment order used by fillOpenLeagueSlotsWithBots — no
// randomness anywhere. ZERO_RB was explicitly excluded from Phase 5.6.
export const BOT_STRATEGY_ROTATION: readonly BotStrategy[] = ["BALANCED", "RB_HEAVY", "WR_HEAVY", "HERO_RB"];

// QB/TE soft penalties are strategy-neutral. Phase 5.5's "2+ owned" bands
// (QB +60, TE +55) are gone: the Phase 5.6 hard onesie cap (QB<=2, TE<=2)
// now removes an owned>=2 candidate from the pool before scoring ever runs,
// so that branch could never execute — keeping it would be untestable dead
// code, not a harmless no-op.
function computeQbPenalty(owned: number): number {
  return owned >= 1 ? 18 : 0;
}
function computeTePenalty(owned: number): number {
  return owned >= 1 ? 15 : 0;
}

// K/DEF timing-only penalty. Phase 5.5's duplicate-ownership component
// (0/+40/+80) is removed for the same reason as the QB/TE 2+ band above:
// the Phase 5.6 hard cap (K<=1, DEF<=1) removes an owned>=1 K/DEF candidate
// from the pool before scoring, so a "you already own one" penalty branch
// could never fire. The timing component is unchanged and still needed —
// it discourages the *first* K/DEF from coming too early; the cap is what
// now prevents a second one, unconditionally.
function computeKDefPenalty(isLateWindow: boolean): number {
  return isLateWindow ? 0 : 100;
}

// Strategy-specific RB/WR bands — the only place BALANCED/RB_HEAVY/
// WR_HEAVY/HERO_RB actually differ. Each is a pure function of owned count.
// HERO_RB's RB band is additionally stateful on owned count only (its
// "secure one, discourage a second, resume depth later" design needs no
// round-awareness, unlike a hypothetical ZERO_RB).
interface StrategyBands {
  rb(owned: number): number;
  wr(owned: number): number;
}

const BOT_STRATEGY_BANDS: Record<BotStrategy, StrategyBands> = {
  BALANCED: {
    rb: (owned) => (owned >= 4 ? 12 : owned === 3 ? 5 : 0),
    wr: (owned) => (owned >= 5 ? 12 : owned === 4 ? 5 : 0),
  },
  RB_HEAVY: {
    rb: (owned) => (owned >= 6 ? 12 : owned === 5 ? 5 : 0),
    wr: (owned) => (owned >= 4 ? 12 : owned === 3 ? 5 : 0),
  },
  WR_HEAVY: {
    rb: (owned) => (owned >= 4 ? 12 : owned === 3 ? 5 : 0),
    wr: (owned) => (owned >= 6 ? 12 : owned === 5 ? 5 : 0),
  },
  HERO_RB: {
    rb: (owned) => {
      if (owned === 0) return 0;
      if (owned === 1) return 25;
      if (owned === 2) return 8;
      return 12; // 3+
    },
    wr: (owned) => (owned >= 5 ? 12 : owned === 4 ? 5 : 0), // same as BALANCED
  },
};

export function computeStrategyPositionPenalty(
  strategy: BotStrategy,
  position: string,
  ownedCounts: Record<string, number>,
  isLateWindow: boolean,
): number {
  const owned = (pos: string): number => ownedCounts[pos] ?? 0;
  switch (position) {
    case "QB":
      return computeQbPenalty(owned("QB"));
    case "TE":
      return computeTePenalty(owned("TE"));
    case "K":
    case "DEF":
      return computeKDefPenalty(isLateWindow);
    case "RB":
      return BOT_STRATEGY_BANDS[strategy].rb(owned("RB"));
    case "WR":
      return BOT_STRATEGY_BANDS[strategy].wr(owned("WR"));
    default:
      return 0;
  }
}
