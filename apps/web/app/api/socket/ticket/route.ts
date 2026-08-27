import { createSocketTicket } from "@fdm/database";
import { auth } from "../../../../lib/auth";

// Mints a short-lived, single-use ticket the browser exchanges for a
// Socket.IO connection (see packages/database/src/auth/socket-ticket.ts).
// Deliberately not the real Auth.js session token: this endpoint is the only
// thing standing between an authenticated same-origin request (which can
// read the httpOnly session cookie) and client-side JS (which never should).
export async function POST() {
  const session = await auth();
  if (!session?.user?.id) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const ticket = await createSocketTicket(session.user.id);
  return Response.json(ticket, { status: 201 });
}
