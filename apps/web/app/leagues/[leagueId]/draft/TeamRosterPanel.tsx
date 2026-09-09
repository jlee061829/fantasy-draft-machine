"use client";

import type { DraftStateResult } from "@fdm/shared";
import { useMemo, useState } from "react";
import { deriveTeamRosters } from "./team-roster-helpers";

interface TeamRosterPanelProps {
  state: DraftStateResult;
  currentUserId: string;
}

// Milestone 4.5: "My Team" by default, with a simple selector to inspect any
// other manager's roster — one panel, not every team stacked vertically.
// selectedUserId is local UI-only selection state (which roster to look at),
// never authoritative draft state; the actual roster contents always come
// from deriveTeamRosters(state), recomputed whenever a fresh authoritative
// snapshot (draft:join/draft:state) replaces `state`.
export function TeamRosterPanel({ state, currentUserId }: TeamRosterPanelProps) {
  const rosters = useMemo(() => deriveTeamRosters(state), [state]);
  const [selectedUserId, setSelectedUserId] = useState(currentUserId);

  const selected = rosters.find((r) => r.userId === selectedUserId) ?? rosters[0] ?? null;

  return (
    <section
      style={{
        padding: 12,
        border: "1px solid #d0d7de",
        borderRadius: 6,
      }}
    >
      <h2 style={{ marginTop: 0 }}>
        {selectedUserId === currentUserId ? "My Team" : selected?.name ?? "Team"}
      </h2>

      <select
        value={selectedUserId}
        onChange={(event) => setSelectedUserId(event.target.value)}
        style={{ marginBottom: 12 }}
      >
        {rosters.map((roster) => (
          <option key={roster.userId} value={roster.userId}>
            {roster.userId === currentUserId ? `${roster.name} (you)` : roster.name} — Slot{" "}
            {roster.draftSlot}
          </option>
        ))}
      </select>

      {!selected || selected.picks.length === 0 ? (
        <p>No picks yet.</p>
      ) : (
        <ol>
          {selected.picks.map((pick) => (
            <li key={pick.pickNumber}>
              {pick.playerName} — {pick.playerPosition}
              {pick.playerNflTeam ? ` ${pick.playerNflTeam}` : ""} (Pick {pick.pickNumber}
              {pick.wasAutopick ? ", auto" : ""})
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}
