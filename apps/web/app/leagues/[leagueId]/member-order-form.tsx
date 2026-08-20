"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

interface Member {
  membershipId: string;
  userId: string;
  name: string;
  image: string | null;
  draftSlot: number;
}

interface MemberOrderFormProps {
  leagueId: string;
  members: Member[];
}

// Minimal manual-verification reorder UI: up/down buttons only, no
// drag-and-drop dependency. Local state holds the desired FULL order; "Save
// order" sends it as an ordered memberIds array so the server can derive
// final slots 1..N from array position, matching the PUT contract.
export function MemberOrderForm({ leagueId, members }: MemberOrderFormProps) {
  const router = useRouter();
  const [order, setOrder] = useState<Member[]>(
    [...members].sort((a, b) => a.draftSlot - b.draftSlot),
  );
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  function move(index: number, direction: -1 | 1) {
    const target = index + direction;
    if (target < 0 || target >= order.length) return;
    const next = [...order];
    [next[index], next[target]] = [next[target], next[index]];
    setOrder(next);
    setSaved(false);
  }

  async function handleSave() {
    setError(null);
    setSaved(false);

    const response = await fetch(`/api/leagues/${leagueId}/members/order`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ memberIds: order.map((m) => m.membershipId) }),
    });

    const body = await response.json();
    if (!response.ok) {
      setError(JSON.stringify(body, null, 2));
      return;
    }
    setSaved(true);
    router.refresh();
  }

  return (
    <div>
      <ol>
        {order.map((member, index) => (
          <li key={member.membershipId}>
            {member.name}
            <button type="button" onClick={() => move(index, -1)} disabled={index === 0}>
              Up
            </button>
            <button
              type="button"
              onClick={() => move(index, 1)}
              disabled={index === order.length - 1}
            >
              Down
            </button>
          </li>
        ))}
      </ol>
      <button type="button" onClick={handleSave}>
        Save order
      </button>
      {saved && <p>Saved.</p>}
      {error && <pre>{error}</pre>}
    </div>
  );
}
