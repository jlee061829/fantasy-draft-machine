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

// Mirrors league-settings-form.tsx's fetch/useState/useRouter shape, but
// deliberately does not reuse its JSON.stringify(body)-to-<pre> error
// pattern: Milestone 4.1 asks for user-facing copy instead of a raw
// implementation dump. Errors are mapped by HTTP status only (see
// mapStatusToMessage) — the POST /api/leagues/[leagueId]/draft endpoint
// returns the same 409 for two distinct causes (DraftAlreadyExistsError vs
// LeagueNotFullError) with no structured code to tell them apart, so this
// deliberately does not try to guess which one occurred from the response
// body. Instead it shows a generic "state changed" message and calls
// router.refresh() so the server component re-fetches getLeagueDetail and
// the page re-renders into whatever is now actually true (e.g. a
// concurrent start elsewhere flips this into the "draft exists" branch).
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

    router.push(`/leagues/${leagueId}/draft`);
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
