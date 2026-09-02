import type { DraftStateResult } from "@fdm/shared";
import { formatCountdown, getDraftPhase } from "./draft-room-helpers";

interface TurnBannerProps {
  draft: DraftStateResult["draft"];
  pickerName: string | null;
  isYourTurn: boolean;
  msRemaining: number;
}

// Purely presentational: every value it renders (phase, formatted
// countdown) is derived from props with getDraftPhase/formatCountdown, the
// same pure helpers the parent's own derivations and the unit tests use.
// This component holds no state of its own, so a fresh authoritative
// draft:state snapshot reaching it as new props is automatically reflected
// with no reset logic here.
export function TurnBanner({ draft, pickerName, isYourTurn, msRemaining }: TurnBannerProps) {
  const phase = getDraftPhase(draft);

  if (phase === "PENDING") {
    return <p>Draft has not started yet.</p>;
  }

  if (phase === "COMPLETE") {
    return (
      <div>
        <strong>Draft complete</strong>
      </div>
    );
  }

  // ACTIVE (and, defensively, any other in-progress status — see
  // getDraftPhase's comment on why PAUSED currently falls through here too)
  const hasDeadline = draft?.turnDeadline != null;

  return (
    <div>
      <strong>{isYourTurn ? "Your turn" : `On the clock: ${pickerName ?? "—"}`}</strong>
      {hasDeadline && <span> — {formatCountdown(msRemaining)} remaining</span>}
    </div>
  );
}
