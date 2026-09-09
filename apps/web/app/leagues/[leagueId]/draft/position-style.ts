// Milestone 4.6: position accent is supplementary only — every caller keeps
// rendering the actual position text (e.g. "WR · CIN") alongside whatever
// this class drives visually (a small colored dot in draft-room.css). This
// module never becomes the sole carrier of position identity, and it knows
// nothing about rendering itself (no JSX, no DOM) — callers apply the
// returned class name to their own markup.
const POSITION_ACCENT_CLASS: Record<string, string> = {
  QB: "fdm-pos-qb",
  RB: "fdm-pos-rb",
  WR: "fdm-pos-wr",
  TE: "fdm-pos-te",
  K: "fdm-pos-k",
  DEF: "fdm-pos-def",
};

const NEUTRAL_ACCENT_CLASS = "fdm-pos-neutral";

export function getPositionAccentClass(position: string): string {
  return POSITION_ACCENT_CLASS[position] ?? NEUTRAL_ACCENT_CLASS;
}
