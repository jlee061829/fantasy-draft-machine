import type { DraftStateResult } from "../draft/draft-state.js";

// The full realtime protocol for Milestone 3.3b. Deliberately small: two
// client events, one server event, and ack-based error responses instead of
// a standalone rejection event. Identity never travels in these payloads —
// it's established once at handshake time via SocketTicket and read from
// socket.data.userId on the server side, never from client-supplied data.

export interface DraftJoinPayload {
  leagueId: string;
}

export interface DraftPickPayload {
  leagueId: string;
  playerId: string;
}

export type SocketErrorCode =
  | "INVALID_PAYLOAD"
  | "LEAGUE_NOT_ACCESSIBLE"
  | "DRAFT_NOT_FOUND"
  | "DRAFT_NOT_ACTIVE"
  | "NOT_ON_THE_CLOCK"
  | "PLAYER_NOT_FOUND"
  | "PLAYER_ALREADY_DRAFTED"
  | "NOT_JOINED"
  | "INTERNAL_ERROR";

export type DraftJoinAck =
  | { ok: true; state: DraftStateResult }
  | { ok: false; error: SocketErrorCode };

export type DraftPickAck = { ok: true } | { ok: false; error: SocketErrorCode };

export interface ClientToServerEvents {
  "draft:join": (payload: DraftJoinPayload, ack: (response: DraftJoinAck) => void) => void;
  "draft:pick": (payload: DraftPickPayload, ack: (response: DraftPickAck) => void) => void;
}

export interface ServerToClientEvents {
  "draft:state": (state: DraftStateResult) => void;
}

export type InterServerEvents = Record<string, never>;

export interface SocketData {
  userId: string;
}
