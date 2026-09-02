import {
  DraftNotActiveError,
  DraftNotFoundError,
  LeagueNotAccessibleError,
  NotOnTheClockError,
  PlayerAlreadyDraftedError,
  PlayerNotFoundError,
  submitPick,
} from "@fdm/database";
import type { DraftPickAck, DraftPickPayload, SocketErrorCode } from "@fdm/shared";
import { leagueRoomName } from "../rooms.js";
import { broadcastDraftState } from "../timers/broadcast.js";
import type { DraftServer, DraftSocket } from "../types.js";
import { draftPickPayloadSchema } from "../validation.js";

// Mirrors the HTTP pick route's error->status mapping
// (apps/web/app/api/leagues/[leagueId]/draft/picks/route.ts) as error->code
// instead, since sockets have no HTTP status. Anything not in this known set
// (e.g. PickAdvanceInvariantError, an unreachable P2002) is logged with full
// detail server-side and acked as a generic INTERNAL_ERROR — the raw
// message/stack never reaches the client.
const KNOWN_ERROR_TYPES = [
  LeagueNotAccessibleError,
  DraftNotFoundError,
  DraftNotActiveError,
  NotOnTheClockError,
  PlayerNotFoundError,
  PlayerAlreadyDraftedError,
] as const;

function mapErrorToCode(error: unknown): SocketErrorCode {
  if (error instanceof LeagueNotAccessibleError) return "LEAGUE_NOT_ACCESSIBLE";
  if (error instanceof DraftNotFoundError) return "DRAFT_NOT_FOUND";
  if (error instanceof DraftNotActiveError) return "DRAFT_NOT_ACTIVE";
  if (error instanceof NotOnTheClockError) return "NOT_ON_THE_CLOCK";
  if (error instanceof PlayerNotFoundError) return "PLAYER_NOT_FOUND";
  if (error instanceof PlayerAlreadyDraftedError) return "PLAYER_ALREADY_DRAFTED";
  return "INTERNAL_ERROR";
}

// submitPick remains the sole correctness boundary (Draft-row FOR UPDATE
// lock, transactional). This handler never duplicates any of that logic —
// it only translates the typed result/error into a socket ack and, on
// success, rebuilds and broadcasts fresh authoritative state via
// getDraftStateForLeague. A rejected pick acks an error and broadcasts
// nothing, so the room never sees a fake successful state.
export async function handleDraftPick(
  io: DraftServer,
  socket: DraftSocket,
  payload: DraftPickPayload,
  ack: (response: DraftPickAck) => void,
): Promise<void> {
  const parsed = draftPickPayloadSchema.safeParse(payload);
  if (!parsed.success) {
    ack({ ok: false, error: "INVALID_PAYLOAD" });
    return;
  }

  const { leagueId, playerId } = parsed.data;
  const room = leagueRoomName(leagueId);
  if (!socket.rooms.has(room)) {
    ack({ ok: false, error: "NOT_JOINED" });
    return;
  }

  try {
    await submitPick(leagueId, socket.data.userId, playerId);
  } catch (error) {
    const isKnown = KNOWN_ERROR_TYPES.some((ErrorType) => error instanceof ErrorType);
    if (!isKnown) {
      console.error("Unexpected error submitting pick via socket", error);
    }
    ack({ ok: false, error: mapErrorToCode(error) });
    return;
  }

  ack({ ok: true });

  await broadcastDraftState(io, leagueId);
}
