"use client";

import type { DraftStateResult } from "@fdm/shared";
import { useMemo, useState } from "react";
import { getRoundForPick } from "./draft-board-helpers";
import { getPositionAccentClass } from "./position-style";
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
//
// Milestone 4.6: the roster selector gets a real (visible) <label>, each
// pick line shows round + overall pick context (via the same
// getRoundForPick the Draft Board uses — one round calculation, not two)
// and a supplementary position accent dot alongside the existing visible
// position text, autopicks get the same small AUTO badge the board uses,
// and the list scrolls internally past a bounded height so a full-length
// roster doesn't push the rest of the live room around.
export function TeamRosterPanel({ state, currentUserId }: TeamRosterPanelProps) {
  const rosters = useMemo(() => deriveTeamRosters(state), [state]);
  const [selectedUserId, setSelectedUserId] = useState(currentUserId);

  const selected = rosters.find((r) => r.userId === selectedUserId) ?? rosters[0] ?? null;
  const teamCount = state.league.teamCount;

  return (
    <section
      style={{
        padding: 12,
        border: "1px solid #d0d7de",
        borderRadius: 6,
      }}
    >
      <h2 style={{ marginTop: 0 }}>
        {selectedUserId === currentUserId ? "My Team" : (selected?.name ?? "Team")}
      </h2>

      <label
        htmlFor="team-roster-select"
        style={{ display: "block", marginBottom: 4, fontSize: 12, color: "#57606a" }}
      >
        View roster
      </label>
      <select
        id="team-roster-select"
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
        <div className="fdm-roster-scroll">
          <ol style={{ margin: 0, paddingLeft: 20 }}>
            {selected.picks.map((pick) => (
              <li key={pick.pickNumber} style={{ marginBottom: 4 }}>
                <span
                  className={`fdm-pos-dot ${getPositionAccentClass(pick.playerPosition)}`}
                  aria-hidden="true"
                />
                {pick.playerName} — {pick.playerPosition}
                {pick.playerNflTeam ? ` ${pick.playerNflTeam}` : ""}
                {pick.wasAutopick && (
                  <span className="fdm-auto-badge" title="Autopicked">
                    AUTO
                  </span>
                )}
                <div style={{ color: "#57606a", fontSize: 12 }}>
                  Round {getRoundForPick(pick.pickNumber, teamCount)} · Pick {pick.pickNumber} overall
                </div>
              </li>
            ))}
          </ol>
        </div>
      )}
    </section>
  );
}
