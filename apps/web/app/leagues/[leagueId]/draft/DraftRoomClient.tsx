"use client";

import type {
  ClientToServerEvents,
  DraftStateResult,
  ServerToClientEvents,
} from "@fdm/shared";
import { useEffect, useMemo, useRef, useState } from "react";
import { io, type Socket } from "socket.io-client";
import type { AvailablePlayer } from "../../../../lib/players/get-available-players";
import { AvailablePlayersPanel } from "./AvailablePlayersPanel";
import { ConnectionStatusBadge, type ConnectionStatus } from "./ConnectionStatusBadge";
import {
  getCurrentPickerName,
  getDraftedPlayerIds,
  getDraftPhase,
  getMsRemaining,
  isYourTurn,
} from "./draft-room-helpers";
import { TurnBanner } from "./TurnBanner";

const SOCKET_SERVER_URL = process.env.NEXT_PUBLIC_SOCKET_SERVER_URL ?? "http://localhost:4000";

type DraftSocket = Socket<ServerToClientEvents, ClientToServerEvents>;

interface DraftRoomClientProps {
  leagueId: string;
  currentUserId: string;
  initialState: DraftStateResult;
  players: AvailablePlayer[];
}

async function mintTicket(): Promise<string> {
  const response = await fetch("/api/socket/ticket", { method: "POST" });
  if (!response.ok) {
    throw new Error(`Failed to mint socket ticket: ${response.status}`);
  }
  const body = (await response.json()) as { token: string };
  return body.token;
}

// Draft-room shell (Milestone 4.2), built on top of the Milestone 3.3b
// realtime transport. The transport itself is unchanged: fresh ticket ->
// connect -> draft:join -> authoritative state, with every draft:state
// broadcast replacing local state wholesale. What's new here is turning
// that into readable presentation — who's on the clock, is it your turn,
// how much time appears to remain, and whether the realtime connection is
// currently healthy.
export function DraftRoomClient({
  leagueId,
  currentUserId,
  initialState,
  players,
}: DraftRoomClientProps) {
  const [status, setStatus] = useState<ConnectionStatus>("connecting");
  const [state, setState] = useState<DraftStateResult>(initialState);
  const [joinError, setJoinError] = useState<string | null>(null);
  const [playerId, setPlayerId] = useState("");
  const [pickError, setPickError] = useState<string | null>(null);
  const socketRef = useRef<DraftSocket | null>(null);

  useEffect(() => {
    // auth is a function, not a static value: Socket.IO invokes it before
    // every (re)connection attempt, so a fresh ticket is minted each time —
    // required since a ticket is single-use and expires 15s after minting.
    const socket: DraftSocket = io(SOCKET_SERVER_URL, {
      auth: (callback) => {
        mintTicket()
          .then((token) => callback({ ticket: token }))
          .catch(() => setStatus("error"));
      },
    });
    socketRef.current = socket;

    // Distinguishes "still trying to establish the very first connection"
    // from "was live, then dropped" — the Socket.IO client itself doesn't
    // draw that line, but the two deserve different labels ("Connecting…"
    // vs "Reconnecting…"). Scoped to this effect run so it resets whenever
    // a new socket is created (leagueId change, or remount).
    let hasConnectedOnce = false;

    socket.on("connect", () => {
      hasConnectedOnce = true;
      socket.emit("draft:join", { leagueId }, (ack) => {
        if (!ack.ok) {
          setStatus("error");
          setJoinError(ack.error);
          return;
        }
        setStatus("connected");
        setJoinError(null);
        setState(ack.state);
      });
    });

    // "io client disconnect" is the reason reported for our own
    // socket.disconnect() call below (effect cleanup) — not a real drop,
    // so it's excluded to avoid a pointless status flip while tearing down.
    //
    // Otherwise, socket.active (a documented public property, cleared by
    // Socket.destroy()) is the real signal for whether Socket.IO will keep
    // retrying on its own: it's false for "io server disconnect" and for
    // any handshake/CONNECT_ERROR-driven close (see the connect_error
    // handler below for why that matters), and true for ordinary transport
    // drops ("ping timeout", "transport close", "transport error"), which
    // the Manager does keep retrying.
    socket.on("disconnect", (reason) => {
      if (reason === "io client disconnect") return;
      setStatus(socket.active ? "reconnecting" : "error");
    });

    // Not every connect_error means Socket.IO is still trying. A pure
    // transport failure (server unreachable) goes through Manager.open()'s
    // error path, which schedules a real retry (maybeReconnectOnOpen) and
    // leaves socket.active true. But when the socket server's handshake
    // middleware rejects the ticket (io.use()'s next(new Error(...)),
    // e.g. an unknown/expired/already-consumed SocketTicket), the server
    // sends a CONNECT_ERROR packet; handling it calls Socket.destroy(),
    // which — since this app never has more than one namespace socket —
    // makes the Manager set skipReconnect = true and close for good
    // (verified against the installed socket.io-client 4.8.3 source:
    // socket.js's onpacket() CONNECT_ERROR case, manager.js's _destroy/
    // _close/onclose). No further event of any kind follows, and
    // Socket.IO will never retry on its own. socket.active (false in
    // exactly this case) is what distinguishes a genuine give-up from an
    // ordinary retry-in-progress, without depending on server error
    // strings or reconnection config this app doesn't control.
    socket.on("connect_error", () => {
      if (!socket.active) {
        setStatus("error");
        return;
      }
      if (hasConnectedOnce) {
        setStatus("reconnecting");
      }
      // else: still trying the very first connection — Socket.IO's default
      // config already retries this automatically, so the initial
      // "Connecting…" status remains accurate as-is.
    });

    // reconnect_attempt/reconnect_failed are emitted by the underlying
    // Manager (socket.io-client 4.8.3's SocketReservedEvents only defines
    // connect/connect_error/disconnect on the Socket itself — reconnection
    // lifecycle events live on socket.io, the Manager), so they're
    // registered there rather than on the socket directly.
    function onReconnectAttempt() {
      if (hasConnectedOnce) {
        setStatus("reconnecting");
      }
    }
    // Reachable only if reconnection attempts are ever capped — the
    // Manager's default reconnectionAttempts is Infinity, so this listener
    // is correct but not expected to fire under the app's current (default)
    // socket options.
    function onReconnectFailed() {
      setStatus("error");
    }
    socket.io.on("reconnect_attempt", onReconnectAttempt);
    socket.io.on("reconnect_failed", onReconnectFailed);

    socket.on("draft:state", (nextState) => {
      setState(nextState);
    });

    return () => {
      socket.io.off("reconnect_attempt", onReconnectAttempt);
      socket.io.off("reconnect_failed", onReconnectFailed);
      socket.disconnect();
      socketRef.current = null;
    };
  }, [leagueId]);

  const phase = getDraftPhase(state.draft);
  const turnDeadline = state.draft?.turnDeadline ?? null;

  // Local "now" tick exists solely to recompute msRemaining each second —
  // it never drives any draft logic. Scoped to ACTIVE drafts with a
  // deadline so nothing ticks before a draft starts or after it completes.
  // The dependency array means a new authoritative turnDeadline (a new
  // draft:state/draft:join snapshot) restarts this effect automatically —
  // there is no separate reset step anywhere for this.
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (phase !== "ACTIVE" || turnDeadline === null) return;
    setNow(Date.now());
    const interval = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(interval);
  }, [phase, turnDeadline]);

  const pickerName = getCurrentPickerName(state);
  const yourTurn = isYourTurn(state, currentUserId);
  const msRemaining = getMsRemaining(turnDeadline, now);
  const draftedPlayerIds = useMemo(() => getDraftedPlayerIds(state), [state]);

  function handleSubmitPick(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPickError(null);
    const socket = socketRef.current;
    if (!socket) return;
    socket.emit("draft:pick", { leagueId, playerId }, (ack) => {
      if (!ack.ok) {
        setPickError(ack.error);
        return;
      }
      setPlayerId("");
    });
  }

  return (
    <main style={{ maxWidth: 720, margin: "0 auto", padding: 16, fontFamily: "sans-serif" }}>
      <header
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "flex-start",
          marginBottom: 16,
        }}
      >
        <div>
          <h1 style={{ margin: 0 }}>{state.league.name}</h1>
          <p style={{ margin: "4px 0", color: "#57606a" }}>
            {state.league.draftType} draft · {state.league.scoringFormat} scoring ·{" "}
            {state.league.rosterSize}-player rosters
          </p>
        </div>
        <ConnectionStatusBadge status={status} />
      </header>

      {joinError && <p style={{ color: "#cf222e" }}>Unable to join draft room: {joinError}</p>}

      <section
        style={{
          padding: 12,
          border: "1px solid #d0d7de",
          borderRadius: 6,
          marginBottom: 16,
        }}
      >
        <TurnBanner
          draft={state.draft}
          pickerName={pickerName}
          isYourTurn={yourTurn}
          msRemaining={msRemaining}
        />
      </section>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
        <section>
          <h2>Members</h2>
          <ol>
            {state.members.map((member) => (
              <li key={member.membershipId}>
                Slot {member.draftSlot}: {member.name}
                {member.userId === currentUserId ? " (you)" : ""}
                {state.draft?.currentUserId === member.userId ? " — on the clock" : ""}
              </li>
            ))}
          </ol>
        </section>

        <section>
          <h2>Picks</h2>
          {state.picks.length === 0 ? (
            <p>No picks yet.</p>
          ) : (
            <ol>
              {state.picks.map((pick) => (
                <li key={pick.pickNumber}>
                  #{pick.pickNumber}: {pick.playerName} ({pick.playerPosition})
                  {pick.wasAutopick ? " · auto" : ""}
                </li>
              ))}
            </ol>
          )}
        </section>
      </div>

      <AvailablePlayersPanel players={players} draftedPlayerIds={draftedPlayerIds} />

      <section
        style={{
          marginTop: 24,
          padding: 12,
          border: "1px dashed #d0d7de",
          borderRadius: 6,
        }}
      >
        <h3 style={{ marginTop: 0 }}>Debug: manual pick (temporary — replaced in Milestone 4.4)</h3>
        <form onSubmit={handleSubmitPick}>
          <label>
            Player ID{" "}
            <input
              value={playerId}
              onChange={(event) => setPlayerId(event.target.value)}
              required
            />
          </label>{" "}
          <button type="submit">Submit pick</button>
        </form>
        {pickError && <p style={{ color: "#cf222e" }}>Pick error: {pickError}</p>}
      </section>
    </main>
  );
}
