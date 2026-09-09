import type { DraftStateResult } from "@fdm/shared";
import { formatCountdown, getCountdownUrgency, getDraftPhase, type RoundInfo } from "./draft-room-helpers";

interface TurnBannerProps {
  draft: DraftStateResult["draft"];
  pickerName: string | null;
  isYourTurn: boolean;
  msRemaining: number;
  roundInfo: RoundInfo | null;
}

const URGENCY_COLOR: Record<"normal" | "warning" | "critical", string> = {
  normal: "inherit",
  warning: "#9a6700",
  critical: "#cf222e",
};

// Purely presentational: every value it renders (phase, round context,
// formatted countdown) is derived from props with getDraftPhase/
// getRoundInfo/formatCountdown, the same pure helpers the parent's own
// derivations and the unit tests use. This component holds no state of its
// own, so a fresh authoritative draft:state snapshot reaching it as new
// props is automatically reflected with no reset logic here.
//
// Milestone 4.6: adds "Round X of Y · Pick Z overall" context and
// warning/critical countdown coloring (presentation only — formatCountdown's
// actual zero-clamping behavior is unchanged). The live-region wrapping is
// deliberately narrow: only the picker-name/turn-state text is
// role="status" aria-live="polite" — it changes only when a real turn
// changes. The ticking countdown text is a plain sibling with no live
// region, so a screen reader isn't re-announced every second.
export function TurnBanner({ draft, pickerName, isYourTurn, msRemaining, roundInfo }: TurnBannerProps) {
  const phase = getDraftPhase(draft);

  if (phase === "PENDING") {
    return <p>Draft has not started yet.</p>;
  }

  if (phase === "COMPLETE") {
    return (
      <div>
        <strong role="status" aria-live="polite">
          Draft complete
        </strong>
      </div>
    );
  }

  // ACTIVE (and, defensively, any other in-progress status — see
  // getDraftPhase's comment on why PAUSED currently falls through here too)
  const hasDeadline = draft?.turnDeadline != null;
  const urgency = getCountdownUrgency(msRemaining);

  return (
    <div>
      {roundInfo && (
        <div style={{ color: "#57606a", fontSize: 13, marginBottom: 2 }}>
          Round {roundInfo.round} of {roundInfo.totalRounds} · Pick {roundInfo.pickNumber} overall
        </div>
      )}
      <strong role="status" aria-live="polite">
        {isYourTurn ? "Your turn" : `On the clock: ${pickerName ?? "—"}`}
      </strong>
      {hasDeadline && (
        <span
          style={{
            color: URGENCY_COLOR[urgency],
            fontWeight: urgency === "critical" ? 700 : 400,
          }}
        >
          {" "}
          — {formatCountdown(msRemaining)} remaining
        </span>
      )}
    </div>
  );
}
