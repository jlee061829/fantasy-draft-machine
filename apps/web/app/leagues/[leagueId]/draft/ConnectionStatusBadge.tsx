export type ConnectionStatus = "connecting" | "connected" | "reconnecting" | "error";

const LABEL: Record<ConnectionStatus, string> = {
  connecting: "Connecting…",
  connected: "Live",
  reconnecting: "Reconnecting…",
  error: "Connection failed",
};

const COLOR: Record<ConnectionStatus, string> = {
  connecting: "#8a6d00",
  connected: "#1a7f37",
  reconnecting: "#8a6d00",
  error: "#cf222e",
};

// Presentational only — the connection lifecycle itself lives entirely in
// DraftRoomClient's socket event listeners. This just renders whatever
// status it's told.
export function ConnectionStatusBadge({ status }: { status: ConnectionStatus }) {
  return (
    <span
      style={{
        display: "inline-block",
        padding: "2px 8px",
        borderRadius: 4,
        fontSize: 13,
        fontWeight: 600,
        color: "#fff",
        backgroundColor: COLOR[status],
      }}
    >
      {LABEL[status]}
    </span>
  );
}
