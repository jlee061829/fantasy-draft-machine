import {
  AutopickExhaustedError,
  BotPickExhaustedError,
  findActiveBotTurnLeagueIds,
  findExpiredActiveDraftLeagueIds,
  processBotDraftTurn,
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

// One full sweep pass: the HUMAN timer-expiry phase, then the BOT-turn
// phase (Phase 5.3). Both phases share this one recurring, self-rescheduling
// timer — there is no second lifecycle, no second scheduler, and no
// immediate recursive bot-chaining. Each phase is independently a
// discover-then-process-each-independently loop, exactly like the
// pre-Phase-5.3 human sweep was; the two phases are kept as separate
// functions (not one function branching on participant type) so BOT and
// HUMAN turn-consumption logic stay legible and independently testable,
// even though they run back-to-back inside the same tick. Exported
// directly (not re-exported through test-support.ts) so sweep.test.ts
// calls it deterministically instead of waiting on the real scheduler.
export async function runSweepOnce(io: DraftServer): Promise<void> {
  await runHumanExpirySweep(io);
  await runBotTurnSweep(io);
}

// Find expired ACTIVE drafts with a HUMAN current participant, attempt to
// process each independently (its own transaction/lock, per
// processExpiredDraftTurn), and broadcast authoritative state only for a
// real autopick. A draft that turns out to be a no-op by the time its
// transaction acquires the lock (a manual pick, another sweep pass, or a
// same-tick BOT pick already consumed the turn) is left alone — no
// broadcast, no error. This is the pre-Phase-5.3 sweep body, unchanged in
// behavior except that findExpiredActiveDraftLeagueIds itself now excludes
// BOT-current drafts at discovery time (a pure efficiency filter —
// processExpiredDraftTurn's own post-lock participantType re-check remains
// the authoritative guard regardless of what this discovery query saw).
async function runHumanExpirySweep(io: DraftServer): Promise<void> {
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

// Phase 5.3: find ACTIVE drafts with a BOT current participant — no
// deadline condition at all, since a BOT's turnDeadline (identical in
// shape to a HUMAN's; see applyPick) carries no special meaning for BOT
// eligibility. A BOT is discovered and processed as soon as this phase
// next runs, typically within one sweep interval of becoming current,
// regardless of how far in the future its stored deadline is. Processes at
// most one pick per league per tick — a BOT->BOT chain simply gets picked
// up again on the next tick rather than being drained in a loop here, which
// is an intentional correctness-first starting point: it bounds each tick's
// work with no recursion/iteration-count logic, at the cost of consecutive
// BOT turns progressing one pick per sweep interval (up to ~2000ms apart by
// default) rather than instantly. A long all-BOT chain is expected to take
// proportionally longer to fully resolve; this is an accepted latency
// tradeoff, not a defect.
async function runBotTurnSweep(io: DraftServer): Promise<void> {
  const leagueIds = await findActiveBotTurnLeagueIds();

  for (const leagueId of leagueIds) {
    let outcome;
    try {
      outcome = await processBotDraftTurn(leagueId);
    } catch (error) {
      // BotPickExhaustedError mirrors AutopickExhaustedError: a genuine
      // data/configuration invariant (the seeded rostered Player pool is
      // smaller than teamCount * rosterSize), not a transient failure —
      // logged and left for a later tick rather than crashing the sweep
      // for every other league being processed. The affected Draft stays
      // ACTIVE with the same BOT current participant.
      if (error instanceof BotPickExhaustedError) {
        console.error(`Bot pick exhausted for league ${leagueId}`, error);
      } else {
        console.error(`Unexpected error processing bot turn for league ${leagueId}`, error);
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
