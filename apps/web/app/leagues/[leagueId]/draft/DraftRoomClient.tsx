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
import { DraftBoard } from "./DraftBoard";
import {
  getCurrentPickerName,
  getDraftedPlayerIds,
  getDraftPhase,
  getMsRemaining,
  getRoundInfo,
  isYourTurn,
} from "./draft-room-helpers";
import { shouldShowActionColumn } from "./available-players-helpers";
import { canSubmitPick, getPickAckAction } from "./pick-submission-helpers";
import { TeamRosterPanel } from "./TeamRosterPanel";
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
  const [pendingPlayerId, setPendingPlayerId] = useState<string | null>(null);
  const [pickError, setPickError] = useState<string | null>(null);
  // Milestone 4.6: distinct from pickError. pickError means the pick itself
  // was rejected (draft:pick ack {ok:false}) — the pick did not happen.
  // resyncError means the OPPOSITE: the pick was already accepted
  // ({ok:true}) and this is only about the follow-up draft:join resync
  // (see handleDraftPlayer below) failing to come back. Wording must never
  // imply the pick failed, since it didn't.
  const [resyncError, setResyncError] = useState<string | null>(null);
  const socketRef = useRef<DraftSocket | null>(null);
  // Synchronous duplicate-emission guard: React state updates (pendingPlayerId)
  // aren't guaranteed to be applied before a second rapid click handler runs,
  // so this ref — mutated immediately, not through setState — is what
  // actually prevents two draft:pick emits for one click burst. It always
  // mirrors "is a pick request currently outstanding" and is cleared in
  // lockstep with pendingPlayerId everywhere that clears it. This is a UX
  // duplicate-emission guard only; it does not replace or weaken the
  // server-side Draft-row lock (submitPick) that is the actual correctness
  // boundary against concurrent picks.
  const pickInFlightRef = useRef(false);

  // The single place authoritative DraftStateResult snapshots are applied —
  // used by both the draft:join ack and the draft:state broadcast listener
  // below. A fresh authoritative snapshot always means whatever pick was
  // pending has now been resolved one way or another (accepted and
  // reflected here, or superseded/rejected and reflected here instead), so
  // clearing pending/in-flight is bundled into every authoritative-state
  // application rather than left to each success path to remember.
  function applyAuthoritativeState(next: DraftStateResult) {
    setState(next);
    setPendingPlayerId(null);
    pickInFlightRef.current = false;
    setResyncError(null);
  }

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
        applyAuthoritativeState(ack.state);
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
      // Any disconnect invalidates an in-flight pick request: its ack (if
      // any was ever going to arrive) can no longer be trusted to reflect
      // this session, so pending/in-flight state is cleared unconditionally
      // here rather than left stuck until reconnect. This never guesses at
      // whether the pick succeeded — reconnect's fresh draft:join resync
      // (via applyAuthoritativeState) is what determines the actual truth.
      setPendingPlayerId(null);
      pickInFlightRef.current = false;
      setResyncError(null);
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
      applyAuthoritativeState(nextState);
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
  const canDraft = canSubmitPick(phase, yourTurn, status, pendingPlayerId);
  const roundInfo = useMemo(() => getRoundInfo(state), [state]);
  // COMPLETE hides the Action column entirely (reusing AvailablePlayersPanel's
  // existing read-only mode) rather than rendering permanently-disabled
  // Draft buttons — see available-players-helpers.ts.
  const showActionColumn = shouldShowActionColumn(phase);

  // Click -> draft:pick -> ack.
  //
  // Milestone 4.6: on a successful ack ({ok:true}), the server has already
  // committed the pick (draft-pick.ts only acks {ok:true} after submitPick
  // resolves) — so rather than passively waiting for the room-wide
  // draft:state broadcast to eventually reach applyAuthoritativeState (which
  // can fail/be lost after a successful commit while the socket stays
  // connected — the known 4.4 edge), this immediately requests fresh
  // authoritative state directly via the existing draft:join round trip.
  // The room-wide draft:state listener above stays registered and
  // unchanged — it's still how every OTHER client in the room finds out
  // about this pick, and if it also reaches this client, applying it again
  // is safe: replacing DraftStateResult wholesale with each valid
  // authoritative snapshot is always safe, whether it's the same state this
  // resync already applied or (if further picks happened in the meantime)
  // an even newer one.
  //
  // If the resync's own draft:join ack comes back rejected, that does NOT
  // mean the pick failed — the original draft:pick ack already confirmed
  // it succeeded. Pending/in-flight are cleared (there's nothing left to
  // wait for from this specific request) and a distinct resyncError is
  // shown instead of pickError, with wording that never implies the pick
  // itself failed.
  //
  // Residual edge, accepted rather than defended against with an arbitrary
  // timeout (see CLAUDE.md Milestone 4.6 notes): if this resync's own ack
  // is itself lost while the socket otherwise appears connected, pending
  // state would remain stuck until either the room-wide draft:state
  // broadcast eventually arrives, or Socket.IO's own ping/pong heartbeat
  // detects the connection is actually dead and fires "disconnect" (which
  // already unconditionally clears pending/in-flight above). This is not a
  // mathematical exactly-once guarantee, but it substantially closes the
  // documented 4.4 failure mode without a broader protocol change.
  function handleDraftPlayer(playerId: string) {
    if (pickInFlightRef.current) return;
    const socket = socketRef.current;
    if (!socket || status !== "connected") return;

    pickInFlightRef.current = true;
    setPendingPlayerId(playerId);
    setPickError(null);
    setResyncError(null);

    socket.emit("draft:pick", { leagueId, playerId }, (ack) => {
      const action = getPickAckAction(ack);

      if (action.type === "error") {
        pickInFlightRef.current = false;
        setPendingPlayerId(null);
        setPickError(action.message);
        return;
      }

      socket.emit("draft:join", { leagueId }, (resyncAck) => {
        if (resyncAck.ok) {
          applyAuthoritativeState(resyncAck.state);
          return;
        }
        pickInFlightRef.current = false;
        setPendingPlayerId(null);
        setResyncError(
          "The draft room couldn't refresh after your pick. Refresh the page to load the latest state.",
        );
      });
    });
  }

  return (
    <main style={{ maxWidth: 1100, margin: "0 auto", padding: 16, fontFamily: "sans-serif" }}>
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

      {joinError && (
        <p role="alert" style={{ color: "#cf222e" }}>
          Unable to join draft room: {joinError}
        </p>
      )}

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
          roundInfo={roundInfo}
        />
      </section>

      <section style={{ marginBottom: 16 }}>
        <h2>Draft Board</h2>
        <DraftBoard state={state} currentUserId={currentUserId} />
      </section>

      <div className="fdm-live-grid">
        <div>
          <AvailablePlayersPanel
            players={players}
            draftedPlayerIds={draftedPlayerIds}
            canDraft={showActionColumn ? canDraft : undefined}
            pendingPlayerId={showActionColumn ? pendingPlayerId : undefined}
            onDraft={showActionColumn ? handleDraftPlayer : undefined}
          />
          {pickError && (
            <p role="alert" style={{ color: "#cf222e", marginTop: 8 }}>
              {pickError}
            </p>
          )}
          {resyncError && (
            <p role="alert" style={{ color: "#cf222e", marginTop: 8 }}>
              {resyncError}
            </p>
          )}
        </div>

        <TeamRosterPanel state={state} currentUserId={currentUserId} />
      </div>
    </main>
  );
}
