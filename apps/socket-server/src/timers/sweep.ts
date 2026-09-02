import {
  AutopickExhaustedError,
  findExpiredActiveDraftLeagueIds,
  processExpiredDraftTurn,
} from "@fdm/database";
import type { DraftServer } from "../types.js";
import { broadcastDraftState } from "./broadcast.js";

// Milestone 3.4: server-owned turn expiry. Deliberately a single recurring
// sweep, not one setTimeout per draft — CLAUDE.md's Timers section settles
// this ("use a single interval on the socket server that checks for
// expired deadlines, not one timer per draft"). A per-draft timer would
// also need explicit bookkeeping to cancel/reschedule on every manual pick
// (exactly the "stale timer" hazard this design avoids) and would need to
// be reconstructed from scratch on every process restart. This design
// needs none of that: findExpiredActiveDraftLeagueIds() is a live
// Postgres read, so a freshly-started process discovers exactly the same
// expired/future drafts a long-running process would have — restart
// recovery is a byproduct of polling live state, not a separate feature.
export const DEFAULT_SWEEP_INTERVAL_MS = 2000;

export interface TurnSweepOptions {
  intervalMs?: number;
}

// One sweep pass: find expired ACTIVE drafts, attempt to process each
// independently (its own transaction/lock, per processExpiredDraftTurn),
// and broadcast authoritative state only for a real autopick. A draft that
// turns out to be a no-op by the time its transaction acquires the lock
// (a manual pick, or another sweep pass, already consumed the turn) is
// left alone — no broadcast, no error. Exported directly (not re-exported
// through test-support.ts) so sweep.test.ts calls it deterministically
// instead of waiting on the real scheduler.
export async function runSweepOnce(io: DraftServer): Promise<void> {
  const leagueIds = await findExpiredActiveDraftLeagueIds();

  for (const leagueId of leagueIds) {
    let outcome;
    try {
      outcome = await processExpiredDraftTurn(leagueId);
    } catch (error) {
      // AutopickExhaustedError is a genuine data/configuration invariant
      // (the seeded Player pool is smaller than teamCount * rosterSize),
      // not a transient failure — logged and skipped for this tick rather
      // than crashing the sweep for every other league being processed.
      if (error instanceof AutopickExhaustedError) {
        console.error(`Autopick exhausted for league ${leagueId}`, error);
      } else {
        console.error(`Unexpected error processing expired turn for league ${leagueId}`, error);
      }
      continue;
    }

    if (outcome.outcome === "picked") {
      await broadcastDraftState(io, leagueId);
    }
  }
}

let sweepTimer: NodeJS.Timeout | null = null;
let sweepGeneration = 0;

// Self-rescheduling setTimeout, not setInterval: the next tick is only
// scheduled after the current one's runSweepOnce() promise settles, so
// ticks can never overlap even if processing a batch of expired drafts
// takes longer than the interval. sweepGeneration guards against a
// straggling scheduled callback from a previous startTurnSweep/stopTurnSweep
// cycle (relevant only in tests, which start/stop the sweep repeatedly
// against the same module-level state) firing after stopTurnSweep() was
// already called.
export function startTurnSweep(io: DraftServer, options: TurnSweepOptions = {}): void {
  if (sweepTimer !== null) {
    throw new Error("startTurnSweep() called while a sweep is already running");
  }

  const intervalMs = options.intervalMs ?? DEFAULT_SWEEP_INTERVAL_MS;
  const generation = ++sweepGeneration;

  const tick = () => {
    if (generation !== sweepGeneration) return;
    void runSweepOnce(io)
      .catch((error: unknown) => {
        console.error("Unexpected error during turn-expiry sweep tick", error);
      })
      .finally(() => {
        if (generation === sweepGeneration) {
          sweepTimer = setTimeout(tick, intervalMs);
        }
      });
  };

  sweepTimer = setTimeout(tick, intervalMs);
  console.log(`turn-expiry sweep started, interval ${intervalMs}ms`);
}

export function stopTurnSweep(): void {
  sweepGeneration++;
  if (sweepTimer !== null) {
    clearTimeout(sweepTimer);
    sweepTimer = null;
  }
  console.log("turn-expiry sweep stopped");
}
