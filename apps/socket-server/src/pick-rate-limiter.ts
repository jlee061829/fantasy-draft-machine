// Phase 6.3: per-user token bucket for the draft:pick socket path.
//
// This is availability/resource protection only, never correctness.
// submitPick's Draft-row FOR UPDATE lock, turn check, and the Pick unique
// constraints remain the sole correctness boundary. What this guards is the
// cost of reaching that boundary: every draft:pick that gets past the
// in-memory payload/room checks opens an interactive transaction (holding a
// pool connection) and takes the same Draft-row lock the legitimate picker
// and both sweep phases need. Socket.IO does not serialize a socket's event
// handlers, so without this, one authenticated member could keep an
// unbounded number of those transactions in flight at once.
//
// Keyed by authenticated userId (socket.data.userId) only — never socket id
// (a user can open many sockets with fresh tickets), never a client-supplied
// leagueId (rotating it would mint fresh buckets), never IP.
//
// State model: Map<key, { tokens, updatedAtMs }>. Refill is computed lazily
// on access (no timers): tokens = min(capacity, tokens + elapsed * rate).
// A bucket that has refilled back to capacity carries no throttling state —
// it behaves exactly like an absent key — so it's safe to drop. Cleanup is
// lazy too: only when inserting a new key while the map is at maxKeys do we
// sweep out full buckets. Everything still left is a bucket used within the
// last `capacity / refillPerSecond` seconds, so live size is bounded by
// recently-active authenticated users.
//
// In-memory and per-process by design: a restart resets every bucket to
// full, which is acceptable because none of this is correctness state. With
// the current single socket-server instance this is the whole limit; under a
// future multi-instance deployment it would become a per-instance limit.

export interface PickRateLimiter {
  tryConsume(key: string): boolean;
  size(): number;
}

export interface PickRateLimiterOptions {
  capacity?: number;
  refillPerSecond?: number;
  maxKeys?: number;
  now?: () => number;
}

// Capacity 3 comfortably covers legitimate use: one pick per turn, two in
// quick succession at a snake round boundary, and the multi-tab case of two
// sockets for the same user emitting at once (see concurrency.test.ts). The
// client's own pickInFlightRef already blocks accidental double-clicks.
export const DEFAULT_PICK_RATE_CAPACITY = 3;
export const DEFAULT_PICK_RATE_REFILL_PER_SECOND = 1;
export const DEFAULT_PICK_RATE_MAX_KEYS = 10_000;

interface Bucket {
  tokens: number;
  updatedAtMs: number;
}

export function createPickRateLimiter(options: PickRateLimiterOptions = {}): PickRateLimiter {
  const capacity = options.capacity ?? DEFAULT_PICK_RATE_CAPACITY;
  const refillPerMs = (options.refillPerSecond ?? DEFAULT_PICK_RATE_REFILL_PER_SECOND) / 1000;
  const maxKeys = options.maxKeys ?? DEFAULT_PICK_RATE_MAX_KEYS;
  const now = options.now ?? Date.now;

  const buckets = new Map<string, Bucket>();

  function refilled(bucket: Bucket, atMs: number): number {
    // Clamp so a clock stepping backwards never removes tokens.
    const elapsedMs = Math.max(0, atMs - bucket.updatedAtMs);
    return Math.min(capacity, bucket.tokens + elapsedMs * refillPerMs);
  }

  function pruneFullBuckets(atMs: number): void {
    for (const [key, bucket] of buckets) {
      if (refilled(bucket, atMs) >= capacity) {
        buckets.delete(key);
      }
    }
  }

  return {
    tryConsume(key: string): boolean {
      const atMs = now();
      const existing = buckets.get(key);

      let tokens: number;
      if (existing) {
        tokens = refilled(existing, atMs);
      } else {
        if (buckets.size >= maxKeys) {
          pruneFullBuckets(atMs);
        }
        tokens = capacity;
      }

      if (tokens < 1) {
        buckets.set(key, { tokens, updatedAtMs: atMs });
        return false;
      }

      buckets.set(key, { tokens: tokens - 1, updatedAtMs: atMs });
      return true;
    },

    size(): number {
      return buckets.size;
    },
  };
}
