"use client";

import type {
  ClientToServerEvents,
  DraftStateResult,
  ServerToClientEvents,
} from "@fdm/shared";
import { useEffect, useRef, useState } from "react";
import { io, type Socket } from "socket.io-client";

const SOCKET_SERVER_URL = process.env.NEXT_PUBLIC_SOCKET_SERVER_URL ?? "http://localhost:4000";

type DraftSocket = Socket<ServerToClientEvents, ClientToServerEvents>;

interface DraftRoomClientProps {
  leagueId: string;
  initialState: DraftStateResult;
}

type ConnectionStatus = "connecting" | "connected" | "error";

async function mintTicket(): Promise<string> {
  const response = await fetch("/api/socket/ticket", { method: "POST" });
  if (!response.ok) {
    throw new Error(`Failed to mint socket ticket: ${response.status}`);
  }
  const body = (await response.json()) as { token: string };
  return body.token;
}

// Manual-verification harness for Milestone 3.3b. Deliberately plain: no
// styling, no roster view, no chat — just enough surface to see the
// realtime transport work end to end (ticket mint -> connect ->
// draft:join -> authoritative state -> draft:pick -> broadcast).
export function DraftRoomClient({ leagueId, initialState }: DraftRoomClientProps) {
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

    socket.on("connect", () => {
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

    socket.on("connect_error", () => {
      setStatus("error");
    });

    socket.on("draft:state", (nextState) => {
      setState(nextState);
    });

    return () => {
      socket.disconnect();
      socketRef.current = null;
    };
  }, [leagueId]);

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
    <main>
      <h1>Draft room</h1>
      <p>Connection status: {status}</p>
      {joinError && <p>Join error: {joinError}</p>}

      <h2>{state.league.name}</h2>
      <p>
        Draft type: {state.league.draftType} · Scoring: {state.league.scoringFormat} · Roster
        size: {state.league.rosterSize}
      </p>

      <h3>Members</h3>
      <ol>
        {state.members.map((member) => (
          <li key={member.membershipId}>
            Slot {member.draftSlot}: {member.name}
          </li>
        ))}
      </ol>

      <h3>Draft state</h3>
      {state.draft ? (
        <dl>
          <dt>Status</dt>
          <dd>{state.draft.status}</dd>
          <dt>Current pick</dt>
          <dd>{state.draft.currentPickNumber}</dd>
          <dt>On the clock</dt>
          <dd>{state.draft.currentUserId ?? "—"}</dd>
        </dl>
      ) : (
        <p>Draft has not started yet.</p>
      )}

      <h3>Picks</h3>
      <ol>
        {state.picks.map((pick) => (
          <li key={pick.pickNumber}>
            #{pick.pickNumber}: {pick.playerName} ({pick.playerPosition})
          </li>
        ))}
      </ol>

      <h3>Submit a pick</h3>
      <form onSubmit={handleSubmitPick}>
        <label>
          Player ID
          <input
            value={playerId}
            onChange={(event) => setPlayerId(event.target.value)}
            required
          />
        </label>
        <button type="submit">Submit pick</button>
      </form>
      {pickError && <p>Pick error: {pickError}</p>}
    </main>
  );
}
