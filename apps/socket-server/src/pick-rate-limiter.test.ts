import { describe, expect, it } from "vitest";
import { createPickRateLimiter } from "./pick-rate-limiter.js";

// Pure, DB-free unit tests. Time is an injected fake clock — nothing sleeps.
function fakeClock(startMs = 1_000_000) {
  let current = startMs;
  return {
    now: () => current,
    advance: (ms: number) => {
      current += ms;
    },
  };
}

describe("createPickRateLimiter", () => {
  it("defaults to capacity 3: the first 3 immediate requests succeed and the 4th fails", () => {
    const clock = fakeClock();
    const limiter = createPickRateLimiter({ now: clock.now });

    expect(limiter.tryConsume("user-a")).toBe(true);
    expect(limiter.tryConsume("user-a")).toBe(true);
    expect(limiter.tryConsume("user-a")).toBe(true);
    expect(limiter.tryConsume("user-a")).toBe(false);
  });

  it("keeps rejecting while no time passes", () => {
    const clock = fakeClock();
    const limiter = createPickRateLimiter({ now: clock.now });
    for (let i = 0; i < 3; i += 1) limiter.tryConsume("user-a");

    for (let i = 0; i < 10; i += 1) {
      expect(limiter.tryConsume("user-a")).toBe(false);
    }
  });

  it("makes exactly one token available after 1 second", () => {
    const clock = fakeClock();
    const limiter = createPickRateLimiter({ now: clock.now });
    for (let i = 0; i < 3; i += 1) limiter.tryConsume("user-a");
    expect(limiter.tryConsume("user-a")).toBe(false);

    clock.advance(999);
    expect(limiter.tryConsume("user-a")).toBe(false);

    clock.advance(1);
    expect(limiter.tryConsume("user-a")).toBe(true);
    expect(limiter.tryConsume("user-a")).toBe(false);
  });

  it("does not let rejected attempts reset or delay refill progress", () => {
    const clock = fakeClock();
    const limiter = createPickRateLimiter({ now: clock.now });
    for (let i = 0; i < 3; i += 1) limiter.tryConsume("user-a");

    clock.advance(500);
    expect(limiter.tryConsume("user-a")).toBe(false);
    clock.advance(500);
    expect(limiter.tryConsume("user-a")).toBe(true);
  });

  it("never refills beyond capacity, however long the key sits idle", () => {
    const clock = fakeClock();
    const limiter = createPickRateLimiter({ now: clock.now });
    limiter.tryConsume("user-a");

    clock.advance(60 * 60 * 1000);

    expect(limiter.tryConsume("user-a")).toBe(true);
    expect(limiter.tryConsume("user-a")).toBe(true);
    expect(limiter.tryConsume("user-a")).toBe(true);
    expect(limiter.tryConsume("user-a")).toBe(false);
  });

  it("keeps different user keys independent", () => {
    const clock = fakeClock();
    const limiter = createPickRateLimiter({ now: clock.now });
    for (let i = 0; i < 3; i += 1) limiter.tryConsume("user-a");
    expect(limiter.tryConsume("user-a")).toBe(false);

    expect(limiter.tryConsume("user-b")).toBe(true);
    expect(limiter.tryConsume("user-b")).toBe(true);
    expect(limiter.tryConsume("user-b")).toBe(true);
    expect(limiter.tryConsume("user-b")).toBe(false);
    expect(limiter.tryConsume("user-a")).toBe(false);
  });

  it("does not treat a backwards clock step as negative elapsed time", () => {
    const clock = fakeClock();
    const limiter = createPickRateLimiter({ now: clock.now });
    limiter.tryConsume("user-a");

    clock.advance(-10_000);

    expect(limiter.tryConsume("user-a")).toBe(true);
    expect(limiter.tryConsume("user-a")).toBe(true);
    expect(limiter.tryConsume("user-a")).toBe(false);
  });

  describe("lazy cleanup", () => {
    it("does not prune anything while below maxKeys", () => {
      const clock = fakeClock();
      const limiter = createPickRateLimiter({ now: clock.now, maxKeys: 3 });
      limiter.tryConsume("user-a");
      limiter.tryConsume("user-b");
      clock.advance(60_000);
      limiter.tryConsume("user-c");

      expect(limiter.size()).toBe(3);
    });

    it("at maxKeys, keeps buckets that still carry throttling state and drops only fully-refilled ones", () => {
      const clock = fakeClock();
      const limiter = createPickRateLimiter({ now: clock.now, maxKeys: 2 });

      // user-a: exhausted — meaningful throttling state.
      for (let i = 0; i < 3; i += 1) limiter.tryConsume("user-a");
      // user-b: partially spent — also still meaningful.
      limiter.tryConsume("user-b");
      expect(limiter.size()).toBe(2);

      // A new key at the cap triggers a prune, but neither existing bucket
      // is full, so both survive and user-a stays throttled.
      limiter.tryConsume("user-c");
      expect(limiter.size()).toBe(3);
      expect(limiter.tryConsume("user-a")).toBe(false);

      // After 1s: user-b (had 2 tokens) is back to full; user-a (0 tokens,
      // its failed attempt above refreshed nothing) has only 1; user-c (had
      // 2) is full. The next new key prunes exactly the full buckets.
      clock.advance(1_000);
      limiter.tryConsume("user-d");
      expect(limiter.size()).toBe(2);

      // user-a's remaining state survived the prune: exactly one token.
      expect(limiter.tryConsume("user-a")).toBe(true);
      expect(limiter.tryConsume("user-a")).toBe(false);
    });

    it("a pruned (fully-refilled) key behaves exactly like a fresh key", () => {
      const clock = fakeClock();
      const limiter = createPickRateLimiter({ now: clock.now, maxKeys: 1 });
      for (let i = 0; i < 3; i += 1) limiter.tryConsume("user-a");

      clock.advance(3_000);
      limiter.tryConsume("user-b");
      expect(limiter.size()).toBe(1);

      expect(limiter.tryConsume("user-a")).toBe(true);
      expect(limiter.tryConsume("user-a")).toBe(true);
      expect(limiter.tryConsume("user-a")).toBe(true);
      expect(limiter.tryConsume("user-a")).toBe(false);
    });
  });
});
