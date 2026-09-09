"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

interface StartDraftFormProps {
  leagueId: string;
  isFull: boolean;
  membersCount: number;
  teamCount: number;
}

type StartStatus = "idle" | "pending" | "error";

// Moved here from the league-detail page in Milestone 4.5: Start Draft now
// lives on the pre-draft page (/leagues/[leagueId]/draft) alongside the
// board/order/players a commissioner is actually looking at, rather than on
// the separate league-settings-ish detail page. The POST target and
// server-side authorization/transaction behavior are unchanged from
// Milestone 4.1 — only where this control is rendered, and where a
// successful start navigates to, have changed.
//
// mapStatusToMessage is unchanged from 4.1: the POST /api/leagues/[leagueId]/draft
// endpoint still returns the same ambiguous 409 for two distinct causes
// (DraftAlreadyExistsError vs LeagueNotFullError) with no structured code to
// tell them apart, so this still shows a generic "state changed" message and
// calls router.refresh() rather than guessing which one occurred.
function mapStatusToMessage(status: number): string {
  switch (status) {
    case 401:
      return "Your session may have expired. Refresh the page and sign in again.";
    case 403:
      return "You don't have permission to start this draft.";
    case 404:
      return "This league is no longer accessible.";
    case 409:
      return "This league's draft state just changed. Refreshing…";
    default:
      return "Something went wrong starting the draft. Please try again.";
  }
}

export function StartDraftForm({ leagueId, isFull, membersCount, teamCount }: StartDraftFormProps) {
  const router = useRouter();
  const [status, setStatus] = useState<StartStatus>("idle");
  const [error, setError] = useState<string | null>(null);

  async function handleStart() {
    setStatus("pending");
    setError(null);

    const response = await fetch(`/api/leagues/${leagueId}/draft`, { method: "POST" });

    if (!response.ok) {
      setStatus("error");
      setError(mapStatusToMessage(response.status));
      if (response.status === 409) {
        router.refresh();
      }
      return;
    }

    // Milestone 4.5: the commissioner who just started the draft goes
    // straight into the live room — no extra "Join Draft Room" click for
    // the person who just performed the start. Other members see the Join
    // Draft Room action appear on this same pre-draft page once they
    // navigate/refresh here (see page.tsx's ACTIVE branch).
    router.push(`/leagues/${leagueId}/draft/room`);
  }

  if (!isFull) {
    return (
      <div>
        <button type="button" disabled>
          Start Draft
        </button>
        <p>
          Waiting for more managers — {membersCount}/{teamCount} joined.
        </p>
      </div>
    );
  }

  return (
    <div>
      <button type="button" onClick={handleStart} disabled={status === "pending"}>
        {status === "pending" ? "Starting…" : "Start Draft"}
      </button>
      {error && <p>{error}</p>}
    </div>
  );
}
