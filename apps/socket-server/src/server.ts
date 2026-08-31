import { createServer, type Server as HttpServer } from "node:http";
import { Server } from "socket.io";
import { authenticateSocket } from "./auth-middleware.js";
import { env } from "./env.js";
import { handleDraftJoin } from "./handlers/draft-join.js";
import { handleDraftPick } from "./handlers/draft-pick.js";
import type { DraftServer } from "./types.js";

export interface SocketServerHandle {
  httpServer: HttpServer;
  io: DraftServer;
}

// Builds (but does not start listening on) the HTTP + Socket.IO server.
// Left unbound so both src/index.ts (real PORT) and tests (ephemeral port
// via httpServer.listen(0)) can control the listen call themselves.
export function createSocketServer(): SocketServerHandle {
  const httpServer = createServer((_req, res) => {
    res.writeHead(200, { "content-type": "text/plain" });
    res.end("fantasy-draft-machine socket server\n");
  });

  const io: DraftServer = new Server(httpServer, {
    cors: {
      // Identity travels via the SocketTicket in the handshake auth payload,
      // not cookies, so no cross-origin credentialed request is needed.
      origin: env.SOCKET_CORS_ORIGIN.split(","),
      credentials: false,
    },
  });

  io.use((socket, next) => {
    void authenticateSocket(socket, next);
  });

  io.on("connection", (socket) => {
    socket.on("draft:join", (payload, ack) => {
      handleDraftJoin(socket, payload, ack).catch((error: unknown) => {
        console.error("Unexpected error handling draft:join", error);
        ack({ ok: false, error: "INTERNAL_ERROR" });
      });
    });

    socket.on("draft:pick", (payload, ack) => {
      handleDraftPick(io, socket, payload, ack).catch((error: unknown) => {
        console.error("Unexpected error handling draft:pick", error);
        ack({ ok: false, error: "INTERNAL_ERROR" });
      });
    });
  });

  return { httpServer, io };
}
