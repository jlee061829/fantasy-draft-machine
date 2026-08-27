import { randomUUID } from "node:crypto";
import { prisma } from "../client.js";

// Short enough that a stolen ticket is useless almost immediately, long
// enough to cover the round trip from minting to the socket handshake that
// consumes it. Reconnection resilience comes from the caller minting a
// fresh ticket per (re)connect attempt, not from this TTL being long.
const TICKET_TTL_MS = 15_000;

export interface MintedSocketTicket {
  token: string;
  expiresAt: string;
}

export async function createSocketTicket(userId: string): Promise<MintedSocketTicket> {
  const token = randomUUID();
  const expiresAt = new Date(Date.now() + TICKET_TTL_MS);
  await prisma.socketTicket.create({ data: { token, userId, expiresAt } });
  return { token, expiresAt: expiresAt.toISOString() };
}

export interface ConsumedSocketTicket {
  userId: string;
}

// Single-use: the WHERE clause (consumedAt IS NULL AND expiresAt in the
// future) is checked and the row updated in one atomic statement, so two
// concurrent consumption attempts for the same token can never both
// succeed — the same "let the database decide" posture as the Draft-row
// lock elsewhere in this package, via a conditional UPDATE rather than
// FOR UPDATE since there's no multi-step transaction to protect here.
export async function consumeSocketTicket(token: string): Promise<ConsumedSocketTicket | null> {
  const { count } = await prisma.socketTicket.updateMany({
    where: { token, consumedAt: null, expiresAt: { gt: new Date() } },
    data: { consumedAt: new Date() },
  });
  if (count !== 1) {
    return null;
  }

  const ticket = await prisma.socketTicket.findUniqueOrThrow({
    where: { token },
    select: { userId: true },
  });
  return { userId: ticket.userId };
}
