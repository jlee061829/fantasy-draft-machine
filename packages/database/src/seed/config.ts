import { ScoringFormat } from "../generated/prisma/enums.js";

// One-line change next year: the seed runner has no other reference to a
// specific season.
export const SEED_YEAR = 2026;

// FFC's ADP is drawn from 12-team mock drafts regardless of the drafting
// league's actual size (see CLAUDE.md's ADP conventions).
export const FFC_TEAMS = 12;

export const SLEEPER_PLAYERS_URL = "https://api.sleeper.app/v1/players/nfl";

export const FFC_BASE_URL = "https://fantasyfootballcalculator.com/api/v1/adp";

// FFC's own format vocabulary in its URL path, mapped onto our ScoringFormat
// enum values.
export const FFC_FORMAT_PARAMS: Record<ScoringFormat, string> = {
  [ScoringFormat.STANDARD]: "standard",
  [ScoringFormat.HALF_PPR]: "half-ppr",
  [ScoringFormat.PPR]: "ppr",
};

export const SCORING_FORMATS: ScoringFormat[] = [
  ScoringFormat.STANDARD,
  ScoringFormat.HALF_PPR,
  ScoringFormat.PPR,
];

export const ADP_SOURCE = "ffc";
