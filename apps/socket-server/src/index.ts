// Must be the first import: validates process.env and fails loudly on boot
// if it's misconfigured, before @fdm/database's Prisma client singleton
// (imported transitively below) reads process.env.DATABASE_URL at
// module-eval time.
import { env } from "./env.js";
import { prisma } from "@fdm/database";
import { createSocketServer } from "./server.js";

const { httpServer, io } = createSocketServer();

httpServer.listen(env.PORT, () => {
  console.log(`socket-server listening on port ${env.PORT}`);
});

async function shutdown(signal: string) {
  console.log(`${signal} received, shutting down socket-server`);
  io.close();
  await prisma.$disconnect();
  process.exit(0);
}

process.on("SIGINT", () => void shutdown("SIGINT"));
process.on("SIGTERM", () => void shutdown("SIGTERM"));
