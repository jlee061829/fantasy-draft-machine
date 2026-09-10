"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

interface RemoveBotsFormProps {
  leagueId: string;
}

type RemoveStatus = "idle" | "pending" | "error";

function mapStatusToMessage(status: number): string {
  switch (status) {
    case 401:
      return "Your session may have expired. Refresh the page and sign in again.";
    case 403:
      return "You don't have permission to manage this league's bots.";
    case 404:
      return "This league is no longer accessible.";
    case 409:
      return "This league's draft state just changed. Refreshing…";
    default:
      return "Something went wrong removing bots. Please try again.";
  }
}

// Phase 5.4: same shape as FillBotsForm/StartDraftForm. A plain
// window.confirm() is the "lightweight confirmation" this milestone calls
// for — deliberately not a custom modal component, consistent with this
// project's minimal-UI-chrome convention elsewhere.
export function RemoveBotsForm({ leagueId }: RemoveBotsFormProps) {
  const router = useRouter();
  const [status, setStatus] = useState<RemoveStatus>("idle");
  const [error, setError] = useState<string | null>(null);

  async function handleRemove() {
    const confirmed = window.confirm(
      "Remove all CPU managers from this league? Their draft slots will reopen for a real manager to join or for another Fill Bots action.",
    );
    if (!confirmed) {
      return;
    }

    setStatus("pending");
    setError(null);

    const response = await fetch(`/api/leagues/${leagueId}/bots`, { method: "DELETE" });

    if (!response.ok) {
      setStatus("error");
      setError(mapStatusToMessage(response.status));
      if (response.status === 409) {
        router.refresh();
      }
      return;
    }

    setStatus("idle");
    router.refresh();
  }

  return (
    <div>
      <button type="button" onClick={handleRemove} disabled={status === "pending"}>
        {status === "pending" ? "Removing…" : "Remove Bots"}
      </button>
      {error && <p>{error}</p>}
    </div>
  );
}
