import { randomUUID } from "node:crypto";
import type { AddressInfo } from "node:net";
import { prisma } from "@fdm/database";
import { createTestPlayer, createTestUser } from "@fdm/database/test-support";
import type { ClientToServerEvents, ServerToClientEvents } from "@fdm/shared";
import { io as ioClient, type Socket as ClientSocketType } from "socket.io-client";
import type { DraftJoinAck, DraftJoinPayload, DraftPickAck, DraftPickPayload } from "@fdm/shared";
import { createSocketServer, type SocketServerHandle } from "./server.js";

export { createTestPlayer, createTestUser };

export type TestClientSocket = ClientSocketType<ServerToClientEvents, ClientToServerEvents>;

interface LeagueOverrides {
  teamCount?: number;
  rosterSize?: number;
  timerSeconds?: number;
  draftType?: "SNAKE" | "LINEAR";
}

export async function createTestLeague(ownerId: string, overrides: LeagueOverrides = {}) {
  return prisma.league.create({
    data: {
      name: "Socket Test League",
      ownerId,
      rosterSize: overrides.rosterSize ?? 8,
      teamCount: overrides.teamCount ?? 4,
      inviteCode: randomUUID().replace(/-/g, "").slice(0, 8).toUpperCase(),
      timerSeconds: overrides.timerSeconds ?? 60,
      scoringFormat: "PPR",
      draftType: overrides.draftType ?? "SNAKE",
    },
  });
}

export async function addMember(leagueId: string, userId: string, draftSlot: number) {
  return prisma.leagueMember.create({ data: { leagueId, userId, draftSlot } });
}

// Creates a fully-filled ACTIVE draft directly via prisma (owner at slot 1,
// generated members filling the rest). Deliberately not reusing apps/web's
// startDraft service — apps/socket-server must not import apps/web
// implementation code. Pick 1 always belongs to slot 1 under both SNAKE and
// LINEAR, so currentUserId can be set directly without needing
// getPickerForPickNumber here.
export async function startFullDraft(overrides: LeagueOverrides = {}) {
  const teamCount = overrides.teamCount ?? 4;
  const owner = await createTestUser();
  const league = await createTestLeague(owner.id, overrides);
  await addMember(league.id, owner.id, 1);

  const others = await Promise.all(Array.from({ length: teamCount - 1 }, () => createTestUser()));
  await Promise.all(others.map((user, i) => addMember(league.id, user.id, i + 2)));

  const membersBySlot: Record<number, string> = { 1: owner.id };
  others.forEach((user, i) => {
    membersBySlot[i + 2] = user.id;
  });

  const draft = await prisma.draft.create({
    data: {
      leagueId: league.id,
      status: "ACTIVE",
      currentPickNumber: 1,
      currentUserId: membersBySlot[1],
      turnDeadline: new Date(Date.now() + (overrides.timerSeconds ?? 60) * 1000),
    },
  });

  return { league, owner, membersBySlot, draft };
}

export async function startTestServer(): Promise<{
  handle: SocketServerHandle;
  baseUrl: string;
}> {
  const handle = createSocketServer();
  await new Promise<void>((resolve) => {
    handle.httpServer.listen(0, () => resolve());
  });
  const address = handle.httpServer.address() as AddressInfo;
  return { handle, baseUrl: `http://localhost:${address.port}` };
}

export async function stopTestServer(handle: SocketServerHandle): Promise<void> {
  handle.io.close();
  await new Promise<void>((resolve) => handle.httpServer.close(() => resolve()));
}

export function connectClient(baseUrl: string, ticket: string): Promise<TestClientSocket> {
  return new Promise((resolve, reject) => {
    const socket: TestClientSocket = ioClient(baseUrl, {
      auth: { ticket },
      reconnection: false,
      forceNew: true,
    });
    socket.on("connect", () => resolve(socket));
    socket.on("connect_error", (err) => reject(err));
  });
}

export function joinDraft(socket: TestClientSocket, payload: DraftJoinPayload): Promise<DraftJoinAck> {
  return new Promise((resolve) => {
    socket.emit("draft:join", payload, resolve);
  });
}

export function submitDraftPick(
  socket: TestClientSocket,
  payload: DraftPickPayload,
): Promise<DraftPickAck> {
  return new Promise((resolve) => {
    socket.emit("draft:pick", payload, resolve);
  });
}
