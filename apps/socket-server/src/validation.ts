import { z } from "zod";

// Strict object schemas: any unknown field — including a client attempting
// to smuggle a userId — fails validation as INVALID_PAYLOAD rather than
// being silently stripped. Identity is never accepted from these payloads;
// it comes exclusively from socket.data.userId, established once at
// handshake time by the SocketTicket auth middleware.
export const draftJoinPayloadSchema = z
  .object({
    leagueId: z.string().min(1),
  })
  .strict();

export const draftPickPayloadSchema = z
  .object({
    leagueId: z.string().min(1),
    playerId: z.string().min(1),
  })
  .strict();
