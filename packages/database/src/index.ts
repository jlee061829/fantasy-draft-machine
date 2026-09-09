export const DATABASE_PACKAGE_NAME = "@fdm/database";

export * from "./generated/prisma/client.js";
export * from "./client.js";
export * from "./drafts/errors.js";
// submit-pick.js and autopick.js also export module-internal helpers
// (lockDraftForLeague, applyPick) shared between the two files. Those must
// never be reachable through @fdm/database's public entry point — they are
// mutation primitives, and apps/web/apps/socket-server may only reach
// draft-mutation behavior through submitPick or processExpiredDraftTurn —
// so this uses explicit named re-exports instead of `export *`, and
// package.json's "exports" field exposes no deep-import path to either
// file for consumers outside this package.
export type { SubmitPickResult } from "./drafts/submit-pick.js";
export { submitPick } from "./drafts/submit-pick.js";
export type { AutopickOutcome } from "./drafts/autopick.js";
export { processExpiredDraftTurn, findExpiredActiveDraftLeagueIds } from "./drafts/autopick.js";
// selectBestAvailablePlayerId (Phase 5.2) is read-only, unlike
// lockDraftForLeague/applyPick above — it can't corrupt draft state by
// itself, so it's exported here rather than kept module-internal. This is
// what lets Phase 5.3's future server-side BOT turn orchestrator (living in
// apps/socket-server, which can only reach @fdm/database through this
// public entry point) call the same ranking logic human timer-autopick
// already uses, without a second boundary change when that work starts.
export { selectBestAvailablePlayerId } from "./drafts/player-selection.js";
export * from "./drafts/get-draft-state.js";
export * from "./leagues/errors.js";
export * from "./auth/socket-ticket.js";
