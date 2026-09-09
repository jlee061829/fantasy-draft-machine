"use client";

import { useMemo, useState } from "react";
import type { AvailablePlayer } from "../../../../lib/players/get-available-players";
import {
  ALL_POSITIONS_FILTER,
  computeAdpRanks,
  filterAvailablePlayers,
  type PositionFilter,
} from "./available-players-helpers";
import { getPositionAccentClass } from "./position-style";

// Same fantasy positions the seed pipeline recognizes
// (packages/database/src/seed/schemas/sleeper.ts's FANTASY_POSITIONS) —
// not hardcoded to QB/RB/WR/TE, since K and DEF are real position values in
// the actual data.
const POSITIONS: readonly string[] = ["QB", "RB", "WR", "TE", "K", "DEF"];

interface AvailablePlayersPanelProps {
  players: AvailablePlayer[];
  draftedPlayerIds: Set<string>;
  // Milestone 4.5: all three are optional so the pre-draft page can reuse
  // this exact component in a read-only mode (search/filter/ADP Rank only,
  // no Action column) instead of a second player-list implementation.
  // Omitting onDraft is what actually drives read-only mode — canDraft/
  // pendingPlayerId are meaningless without it and are ignored if somehow
  // provided without it. Milestone 4.6: the live room also uses this same
  // read-only mode once the Draft is COMPLETE (see
  // available-players-helpers.ts's shouldShowActionColumn), so the Action
  // column disappears entirely rather than showing permanently-disabled
  // Draft buttons.
  canDraft?: boolean;
  pendingPlayerId?: string | null;
  onDraft?: (playerId: string) => void;
}

// Milestone 4.3: read-only player discovery. Owns its own search/position
// local UI state (not lifted into DraftRoomClient — nothing outside this
// panel needs it) and derives the visible rows from props via useMemo.
// Player identity/availability itself remains entirely prop-driven, so a
// fresh draft:state snapshot flowing down through draftedPlayerIds is all
// it takes for a newly-drafted player to disappear here — no local
// "remove this row" logic exists.
//
// Milestone 4.4 adds the Draft action per row exactly as anticipated above:
// canDraft/pendingPlayerId/onDraft are the only new props, and this
// component still never touches the socket itself — DraftRoomClient remains
// the sole owner of submission/connection state and just tells this panel
// whether drafting is currently allowed and which row (if any) is pending.
//
// Milestone 4.6: accessibility pass. Search/position filter get real
// <label>s (visually hidden — the input's placeholder and the panel's own
// heading already communicate their purpose visually, but a label is
// required for the field to have any accessible name at all), each Draft
// button gets a player-specific accessible name (a flat list of buttons all
// named "Draft" is meaningless out of visual context), and position gets a
// small supplementary color accent that never replaces the visible
// position text.
export function AvailablePlayersPanel({
  players,
  draftedPlayerIds,
  canDraft,
  pendingPlayerId,
  onDraft,
}: AvailablePlayersPanelProps) {
  const [search, setSearch] = useState("");
  const [position, setPosition] = useState<PositionFilter>(ALL_POSITIONS_FILTER);

  const visiblePlayers = useMemo(
    () => filterAvailablePlayers(players, draftedPlayerIds, search, position),
    [players, draftedPlayerIds, search, position],
  );

  // Computed from the full, unfiltered `players` prop — never from
  // visiblePlayers — so a player's displayed rank stays fixed regardless of
  // search/position filtering. See computeAdpRanks's own comment for why a
  // simple sequential counter over the already-sorted pool is sufficient.
  const adpRanks = useMemo(() => computeAdpRanks(players), [players]);

  return (
    <section
      style={{
        marginTop: 16,
        padding: 12,
        border: "1px solid #d0d7de",
        borderRadius: 6,
      }}
    >
      <h2 style={{ marginTop: 0 }}>Available Players</h2>

      <div style={{ display: "flex", gap: 8, marginBottom: 12, flexWrap: "wrap" }}>
        <div style={{ flex: "1 1 200px" }}>
          <label htmlFor="available-players-search" className="sr-only">
            Search players by name
          </label>
          <input
            id="available-players-search"
            type="text"
            placeholder="Search players…"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            style={{ width: "100%", padding: 6, boxSizing: "border-box" }}
          />
        </div>
        <div>
          <label htmlFor="available-players-position" className="sr-only">
            Filter by position
          </label>
          <select
            id="available-players-position"
            value={position}
            onChange={(event) => setPosition(event.target.value)}
          >
            <option value={ALL_POSITIONS_FILTER}>All</option>
            {POSITIONS.map((pos) => (
              <option key={pos} value={pos}>
                {pos}
              </option>
            ))}
          </select>
        </div>
      </div>

      {visiblePlayers.length === 0 ? (
        <p>No players match your search/filter.</p>
      ) : (
        <div className="fdm-table-scroll">
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead>
              <tr style={{ textAlign: "left", borderBottom: "1px solid #d0d7de" }}>
                <th scope="col" style={{ padding: "4px 8px" }}>
                  Player
                </th>
                <th scope="col" style={{ padding: "4px 8px" }}>
                  Pos
                </th>
                <th scope="col" style={{ padding: "4px 8px" }}>
                  Team
                </th>
                <th scope="col" style={{ padding: "4px 8px" }}>
                  ADP Rank
                </th>
                {onDraft && (
                  <th scope="col" style={{ padding: "4px 8px" }}>
                    <span className="sr-only">Draft action</span>
                  </th>
                )}
              </tr>
            </thead>
            <tbody>
              {visiblePlayers.map((player) => {
                const isPending = pendingPlayerId === player.id;
                return (
                  <tr key={player.id} style={{ borderBottom: "1px solid #eaeef2" }}>
                    <td style={{ padding: "4px 8px" }}>{player.fullName}</td>
                    <td style={{ padding: "4px 8px" }}>
                      <span
                        className={`fdm-pos-dot ${getPositionAccentClass(player.position)}`}
                        aria-hidden="true"
                      />
                      {player.position}
                    </td>
                    <td style={{ padding: "4px 8px" }}>{player.nflTeam}</td>
                    <td style={{ padding: "4px 8px" }}>{adpRanks.get(player.id) ?? "—"}</td>
                    {onDraft && (
                      <td style={{ padding: "4px 8px" }}>
                        <button
                          type="button"
                          disabled={!canDraft}
                          aria-label={
                            isPending ? `Drafting ${player.fullName}…` : `Draft ${player.fullName}`
                          }
                          onClick={() => onDraft(player.id)}
                        >
                          {isPending ? "Drafting…" : "Draft"}
                        </button>
                      </td>
                    )}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
