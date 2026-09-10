import type { DraftStateResult } from "@fdm/shared";
import { deriveDraftBoard, getRoundDirection, type DraftBoardCell } from "./draft-board-helpers";
import { getPositionAccentClass } from "./position-style";

interface DraftBoardProps {
  state: DraftStateResult;
  // Milestone 4.6: optional so a caller that genuinely has no authenticated
  // identity available can still render the board unhighlighted — in
  // practice both current callers (the pre-draft page and the live room)
  // always pass it.
  currentUserId?: string;
}

const MIN_COLUMN_WIDTH_PX = 110;
const ROUND_COLUMN_WIDTH_PX = 70;

function cellClassName(cell: DraftBoardCell, isUserColumn: boolean): string | undefined {
  const classes: string[] = [];
  if (cell.isCurrentPick) {
    classes.push("fdm-current-pick");
  } else if (!cell.pick) {
    classes.push("fdm-empty-cell");
  }
  if (isUserColumn) {
    classes.push("fdm-user-column");
  }
  return classes.length > 0 ? classes.join(" ") : undefined;
}

// Milestone 4.5: presentational only — every cell comes from
// deriveDraftBoard, which is the one shared derivation both the pre-draft
// page (a static, picks-less DraftStateResult, rendered server-side with no
// hooks available) and the live room (the real socket-updated one, rendered
// client-side) feed into this same component. No board state is owned
// here — deriveDraftBoard is a plain, cheap (bounded at rosterSize *
// teamCount cells) synchronous call, so it's invoked directly on every
// render rather than memoized, which is what keeps this component free of
// hooks and therefore usable from both a Server Component and a Client
// Component tree without a "use client" directive of its own.
//
// Milestone 4.6: readability/accessibility pass. Column headers are now
// built from every draftSlot 1..teamCount (not from state.members, whose
// length can be smaller than teamCount pre-draft) so a header always lines
// up with its column even for an underfilled league, and each gets a proper
// scope="col"/scope="row" table semantic. The authenticated user's column
// gets a "(you)" text marker (never color alone) plus a subtle background;
// the current-pick cell gets visible "On the clock" text plus an .sr-only
// announcement (again never color alone), and is styled to read as stronger
// than the user-column highlight even when both apply to the same cell (see
// draft-room.css's .fdm-current-pick.fdm-user-column rule).
export function DraftBoard({ state, currentUserId }: DraftBoardProps) {
  const board = deriveDraftBoard(state);
  const userMember = currentUserId
    ? state.members.find((m) => m.userId === currentUserId)
    : undefined;
  const userDraftSlot: number | null = userMember ? userMember.draftSlot : null;
  const tableMinWidth = ROUND_COLUMN_WIDTH_PX + board.slots * MIN_COLUMN_WIDTH_PX;

  return (
    <div className="fdm-table-scroll">
      <table
        style={{ width: "100%", minWidth: tableMinWidth, borderCollapse: "collapse", fontSize: 13 }}
      >
        <thead>
          <tr style={{ textAlign: "left", borderBottom: "1px solid #d0d7de" }}>
            <th scope="col" style={{ padding: "4px 8px", width: ROUND_COLUMN_WIDTH_PX }}>
              Round
            </th>
            {Array.from({ length: board.slots }, (_, i) => i + 1).map((slot) => {
              const member = state.members.find((m) => m.draftSlot === slot);
              const isUserColumn = slot === userDraftSlot;
              return (
                <th
                  key={slot}
                  scope="col"
                  className={isUserColumn ? "fdm-user-column" : undefined}
                  style={{ padding: "4px 8px" }}
                >
                  {member ? (
                    <>
                      {member.name}
                      {member.participantType === "BOT" ? " (BOT)" : ""}
                      {member.userId === currentUserId ? " (you)" : ""}
                    </>
                  ) : (
                    <span style={{ color: "#8c959f" }}>Slot {slot} — open</span>
                  )}
                </th>
              );
            })}
          </tr>
        </thead>
        <tbody>
          {board.cells.map((row, i) => {
            const round = i + 1;
            const direction = getRoundDirection(round, state.league.draftType);
            return (
              <tr key={round} style={{ borderBottom: "1px solid #eaeef2" }}>
                <th scope="row" style={{ padding: "4px 8px", fontWeight: 600, textAlign: "left" }}>
                  Round {round}
                  <span aria-hidden="true" style={{ marginLeft: 4, color: "#57606a" }}>
                    {direction}
                  </span>
                  <span className="sr-only">
                    {direction === "→" ? ", picks left to right" : ", picks right to left"}
                  </span>
                </th>
                {row.map((cell) => {
                  const isUserColumn = cell.draftSlot === userDraftSlot;
                  return (
                    <td
                      key={cell.draftSlot}
                      className={cellClassName(cell, isUserColumn)}
                      style={{ padding: "4px 8px" }}
                    >
                      {cell.pick ? (
                        <div>
                          <div style={{ fontSize: 11, color: "#57606a" }}>Pick {cell.pickNumber}</div>
                          <div style={{ fontWeight: 600 }}>
                            {cell.pick.playerName}
                            {cell.pick.wasAutopick && (
                              <span className="fdm-auto-badge" title="Autopicked">
                                AUTO
                              </span>
                            )}
                          </div>
                          <div style={{ color: "#57606a", fontSize: 12 }}>
                            <span
                              className={`fdm-pos-dot ${getPositionAccentClass(cell.pick.playerPosition)}`}
                              aria-hidden="true"
                            />
                            {cell.pick.playerPosition}
                            {cell.pick.playerNflTeam ? ` · ${cell.pick.playerNflTeam}` : ""}
                          </div>
                        </div>
                      ) : cell.isCurrentPick ? (
                        <div>
                          <div style={{ fontSize: 11, fontWeight: 700, color: "#0969da" }}>
                            On the clock
                          </div>
                          <span className="sr-only">Pick {cell.pickNumber}, current pick</span>
                        </div>
                      ) : (
                        <span style={{ color: "#8c959f" }} aria-hidden="true">
                          —
                        </span>
                      )}
                    </td>
                  );
                })}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
