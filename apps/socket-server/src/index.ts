// Must be the first import: validates process.env and fails loudly on boot
// if it's misconfigured, before @fdm/database's Prisma client singleton
// (imported transitively below) reads process.env.DATABASE_URL at
// module-eval time.
import { env } from "./env.js";
import { prisma } from "@fdm/database";
import { createSocketServer } from "./server.js";
import { startTurnSweep, stopTurnSweep } from "./timers/sweep.js";

const { httpServer, io } = createSocketServer();

httpServer.listen(env.PORT, () => {
  console.log(`socket-server listening on port ${env.PORT}`);
  // Started here, not inside createSocketServer(), so every other test that
  // builds a server via createSocketServer()/startTestServer() doesn't
  // silently pick up a live background DB-polling interval. Production
  // gets the default 2000ms interval; only sweep.test.ts passes a shorter
  // one directly to startTurnSweep().
  startTurnSweep(io);
});

async function shutdown(signal: string) {
  console.log(`${signal} received, shutting down socket-server`);
  stopTurnSweep();
  io.close();
  await prisma.$disconnect();
  process.exit(0);
}

process.on("SIGINT", () => void shutdown("SIGINT"));
process.on("SIGTERM", () => void shutdown("SIGTERM"));
