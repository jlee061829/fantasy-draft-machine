import { consumeSocketTicket } from "@fdm/database";
import type { DraftSocket } from "./types.js";

// Registered via io.use(...) before any event handler runs. Reads the ticket
// only from the handshake auth payload (never a query string or header), so
// it never lands in server access logs or a browser history entry. Unknown,
// expired, and already-consumed tickets are rejected with the same generic
// "unauthorized" message — consumeSocketTicket itself already collapses
// those cases into one null return, and this middleware doesn't add any new
// distinction on top of it. Every path below calls next() exactly once, so a
// caller can register this directly as `io.use((socket, next) => {
// void authenticateSocket(socket, next); })` without an extra try/catch.
export async function authenticateSocket(
  socket: DraftSocket,
  next: (err?: Error) => void,
): Promise<void> {
  const ticket: unknown = socket.handshake.auth?.ticket;
  if (typeof ticket !== "string" || ticket.length === 0) {
    next(new Error("unauthorized"));
    return;
  }

  let consumed;
  try {
    consumed = await consumeSocketTicket(ticket);
  } catch (error) {
    console.error("Unexpected error consuming socket ticket", error);
    next(new Error("unauthorized"));
    return;
  }

  if (!consumed) {
    next(new Error("unauthorized"));
    return;
  }

  socket.data.userId = consumed.userId;
  next();
}
