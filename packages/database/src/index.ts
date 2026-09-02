export const DATABASE_PACKAGE_NAME = "@fdm/database";

export * from "./generated/prisma/client.js";
export * from "./client.js";
export * from "./drafts/errors.js";
// submit-pick.js and autopick.js also export module-internal helpers
// (lockDraftForLeague, applyPick, selectAutopickPlayerId) shared between
// the two files. Those must never be reachable through @fdm/database's
// public entry point — apps/web and apps/socket-server may only reach
// draft-mutation behavior through submitPick or processExpiredDraftTurn —
// so this uses explicit named re-exports instead of `export *`, and
// package.json's "exports" field exposes no deep-import path to either
// file for consumers outside this package.
export type { SubmitPickResult } from "./drafts/submit-pick.js";
export { submitPick } from "./drafts/submit-pick.js";
export type { AutopickOutcome } from "./drafts/autopick.js";
export { processExpiredDraftTurn, findExpiredActiveDraftLeagueIds } from "./drafts/autopick.js";
export * from "./drafts/get-draft-state.js";
export * from "./leagues/errors.js";
export * from "./auth/socket-ticket.js";
