import type { DraftStateResult } from "@fdm/shared";
import { deriveDraftBoard } from "./draft-board-helpers";

interface DraftBoardProps {
  state: DraftStateResult;
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
export function DraftBoard({ state }: DraftBoardProps) {
  const board = deriveDraftBoard(state);

  return (
    <div style={{ overflowX: "auto" }}>
      <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
        <thead>
          <tr style={{ textAlign: "left", borderBottom: "1px solid #d0d7de" }}>
            <th style={{ padding: "4px 8px" }}>Round</th>
            {state.members.map((member) => (
              <th key={member.membershipId} style={{ padding: "4px 8px" }}>
                Slot {member.draftSlot}: {member.name}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {board.cells.map((row, i) => (
            <tr key={i} style={{ borderBottom: "1px solid #eaeef2" }}>
              <td style={{ padding: "4px 8px", fontWeight: 600 }}>{i + 1}</td>
              {row.map((cell) => (
                <td
                  key={cell.draftSlot}
                  style={{
                    padding: "4px 8px",
                    backgroundColor: cell.isCurrentPick ? "#ddf4ff" : undefined,
                    border: cell.isCurrentPick ? "1px solid #0969da" : undefined,
                  }}
                >
                  {cell.pick ? (
                    <>
                      <div>
                        {cell.pick.playerName} ({cell.pick.playerPosition}
                        {cell.pick.playerNflTeam ? ` · ${cell.pick.playerNflTeam}` : ""})
                        {cell.pick.wasAutopick ? " · auto" : ""}
                      </div>
                      <div style={{ color: "#57606a" }}>Pick {cell.pickNumber}</div>
                    </>
                  ) : (
                    <span style={{ color: "#8c959f" }}>—</span>
                  )}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
