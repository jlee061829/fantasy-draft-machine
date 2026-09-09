import type { ReactNode } from "react";
import "./draft-room.css";

// Milestone 4.6: scopes the small responsive/position-accent/sr-only
// stylesheet to exactly this route subtree (the pre-draft page and the live
// room nested under it) without touching the root layout or introducing a
// styling framework. Plain pass-through — no markup of its own.
export default function DraftLayout({ children }: { children: ReactNode }) {
  return children;
}
