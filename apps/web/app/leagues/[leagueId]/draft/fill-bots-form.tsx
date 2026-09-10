"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

interface FillBotsFormProps {
  leagueId: string;
  openSlotCount: number;
}

type FillStatus = "idle" | "pending" | "error";

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
      return "Something went wrong filling open slots. Please try again.";
  }
}

// Phase 5.4: the first production UI that can create a BOT LeagueMember.
// Mirrors StartDraftForm's shape exactly (idle/pending/error state, fetch,
// status-to-copy mapping) rather than introducing a new pattern. Unlike
// StartDraftForm, a successful Fill doesn't navigate anywhere — the
// commissioner stays on the pre-draft page, so success is handled the same
// way the existing 409 case already is: router.refresh() lets the Server
// Component re-fetch getLeagueDetail and re-render the true, authoritative
// membership/order/board. No optimistic membership mutation is made here.
export function FillBotsForm({ leagueId, openSlotCount }: FillBotsFormProps) {
  const router = useRouter();
  const [status, setStatus] = useState<FillStatus>("idle");
  const [error, setError] = useState<string | null>(null);

  async function handleFill() {
    setStatus("pending");
    setError(null);

    const response = await fetch(`/api/leagues/${leagueId}/bots/fill`, { method: "POST" });

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
      <button type="button" onClick={handleFill} disabled={status === "pending"}>
        {status === "pending"
          ? "Filling…"
          : `Fill ${openSlotCount} Open Slot${openSlotCount === 1 ? "" : "s"} with Bots`}
      </button>
      {error && <p>{error}</p>}
    </div>
  );
}
