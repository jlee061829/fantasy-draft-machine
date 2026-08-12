const SUFFIXES = new Set(["jr", "sr", "ii", "iii", "iv"]);

// Team defenses are matched on team code, not name (see seed pipeline plan),
// so this function is never called with a defense name.
export function normalizePlayerName(fullName: string): string {
  const cleaned = fullName
    .toLowerCase()
    .replace(/[^\p{L}\s]/gu, "") // strips periods, hyphens, straight/curly apostrophes, etc.
    .replace(/\s+/g, " ")
    .trim();

  const words = cleaned.split(" ").filter(Boolean);
  const lastWord = words[words.length - 1];
  const withoutSuffix =
    lastWord !== undefined && SUFFIXES.has(lastWord)
      ? words.slice(0, -1)
      : words;

  return withoutSuffix.join(" ");
}
