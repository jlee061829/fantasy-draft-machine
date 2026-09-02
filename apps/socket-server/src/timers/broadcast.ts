import { getDraftStateForLeague } from "@fdm/database";
import { leagueRoomName } from "../rooms.js";
import type { DraftServer } from "../types.js";

// Shared by the draft:pick handler (accepted manual picks) and the
// turn-expiry sweep (real autopicks): re-read authoritative state and emit
// one full draft:state snapshot to the league's room. Extracted here so
// both callers use the exact same authoritative-state broadcast path
// instead of two copies of the same three lines.
export async function broadcastDraftState(io: DraftServer, leagueId: string): Promise<void> {
  const state = await getDraftStateForLeague(leagueId);
  if (state) {
    io.to(leagueRoomName(leagueId)).emit("draft:state", state);
  }
}
