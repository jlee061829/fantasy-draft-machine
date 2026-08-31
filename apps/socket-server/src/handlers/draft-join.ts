import { getDraftState } from "@fdm/database";
import type { DraftJoinAck, DraftJoinPayload } from "@fdm/shared";
import { leagueRoomName } from "../rooms.js";
import type { DraftSocket } from "../types.js";
import { draftJoinPayloadSchema } from "../validation.js";

// Authorization and room membership happen together: a socket only joins
// the room after getDraftState confirms current LeagueMember access, and
// nonexistent/inaccessible leagues collapse to the same LEAGUE_NOT_ACCESSIBLE
// ack without ever calling socket.join — mirroring getDraftState's own
// collapse of "no such league" and "authenticated non-member" into one null
// result. State is delivered only through the ack; there's no separate
// emitted event for the join response.
export async function handleDraftJoin(
  socket: DraftSocket,
  payload: DraftJoinPayload,
  ack: (response: DraftJoinAck) => void,
): Promise<void> {
  const parsed = draftJoinPayloadSchema.safeParse(payload);
  if (!parsed.success) {
    ack({ ok: false, error: "INVALID_PAYLOAD" });
    return;
  }

  const state = await getDraftState(parsed.data.leagueId, socket.data.userId);
  if (!state) {
    ack({ ok: false, error: "LEAGUE_NOT_ACCESSIBLE" });
    return;
  }

  await socket.join(leagueRoomName(parsed.data.leagueId));
  ack({ ok: true, state });
}
