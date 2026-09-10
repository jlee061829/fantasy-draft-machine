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
//
// Phase 5.1: the selector is keyed by membershipId, not userId — a BOT
// roster's userId is null, and userId is no longer unique across rosters
// once more than one BOT can exist in a league (every bot would collide on
// the same null/"" <option> value). membershipId is unique for every
// participant, HUMAN or BOT, so it's the only safe selection key here.
export function TeamRosterPanel({ state, currentUserId }: TeamRosterPanelProps) {
  const rosters = useMemo(() => deriveTeamRosters(state), [state]);
  const viewerMembershipId =
    rosters.find((r) => r.userId === currentUserId)?.membershipId ?? (rosters[0]?.membershipId ?? "");
  const [selectedMembershipId, setSelectedMembershipId] = useState(viewerMembershipId);

  const selected = rosters.find((r) => r.membershipId === selectedMembershipId) ?? rosters[0] ?? null;
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
        {selectedMembershipId === viewerMembershipId ? "My Team" : (selected?.name ?? "Team")}
      </h2>

      <label
        htmlFor="team-roster-select"
        style={{ display: "block", marginBottom: 4, fontSize: 12, color: "#57606a" }}
      >
        View roster
      </label>
      <select
        id="team-roster-select"
        value={selectedMembershipId}
        onChange={(event) => setSelectedMembershipId(event.target.value)}
        style={{ marginBottom: 12 }}
      >
        {rosters.map((roster) => {
          const label =
            roster.membershipId === viewerMembershipId ? `${roster.name} (you)` : roster.name;
          return (
            <option key={roster.membershipId} value={roster.membershipId}>
              {label}
              {roster.participantType === "BOT" ? " (BOT)" : ""} — Slot {roster.draftSlot}
            </option>
          );
        })}
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
