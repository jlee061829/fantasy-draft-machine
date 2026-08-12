// Sleeper and FFC occasionally spell the same NFL team differently. These are
// the known real-world discrepancies across fantasy platforms; anything else
// is assumed to already be a shared abbreviation and is left as-is (aside
// from case/whitespace) rather than guessed at.
const TEAM_ALIASES: Record<string, string> = {
  JAC: "JAX",
  WSH: "WAS",
};

export function normalizeTeamCode(team: string): string {
  const upper = team.toUpperCase().trim();
  return TEAM_ALIASES[upper] ?? upper;
}
