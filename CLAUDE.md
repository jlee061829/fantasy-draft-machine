# Fantasy Football Draft Room — Project Brief

## What we're building

A real-time, multiplayer fantasy football draft room. Multiple users join a league, enter a live draft room, and take turns picking players from a shared pool. Every connected client sees picks, timers, and presence updates instantly. If a user's pick timer expires, the server autopicks for them. If a user disconnects mid-draft, they can reconnect and resync without stalling the draft for everyone else.

This is a portfolio project. The point is not to compete with Sleeper or ESPN — it is to demonstrate correct handling of concurrent writes, server-authoritative real-time state, and full-stack TypeScript with a real deployment. Prioritize correctness and clarity over feature count.

## Current implementation status

Last updated: September 2026

### Completed

- pnpm workspace scaffold with `apps/web`, `apps/socket-server`, `packages/shared`, and `packages/database`
- TypeScript `strict: true` configured across the workspace
- Next.js App Router application shell
- Standalone Node socket-server shell
- Shared TypeScript package and Prisma/database package
- Local PostgreSQL 17 running through Docker Compose
- Project environment variables managed with `.env` + direnv
- Project-scoped Filesystem, GitHub, Playwright, and PostgreSQL MCP servers configured for Claude Code
- Workspace installs, typechecks, and builds successfully
- GitHub repository configured; current scaffold checkpoint committed and pushed
- Prisma 7 schema implemented with all domain models plus Auth.js persistence models
- Initial `init_schema` migration created and applied successfully
- Prisma Client generated successfully
- Local Postgres verified through the PostgreSQL MCP with all expected tables and critical unique constraints present
- Local Redis 8 running through Docker Compose
- Prisma 7 runtime client configured with `@prisma/adapter-pg`
- Auth.js v5 implemented with GitHub OAuth and the Prisma adapter
- Database-backed Auth.js sessions verified end to end
- GitHub OAuth verified to persist linked `User`, `Account`, and `Session` records
- Sign-in and sign-out flow verified through the Next.js app
- Seed pipeline data-contract/testing foundation:
  - verified live 2026 Sleeper and Fantasy Football Calculator ADP response shapes
  - added Zod schemas for consumed Sleeper/FFC fields
  - added pure player-name normalization
  - added Vitest configuration with 16 normalization tests covering suffixes, initials, apostrophes, curly apostrophes, hyphens, punctuation, and whitespace
- Deterministic Sleeper ↔ FFC matching layer implemented:
  - fantasy position normalization
  - NFL team-code normalization
  - name-based player matching
  - DEF matching by team code
  - team/position ambiguity tiebreakers
  - explicit matched/unmatched/ambiguous results
  - 51 total seed-pipeline tests passing
  - 2026 Sleeper + Fantasy Football Calculator seed runner implemented:
  - fetches and validates live Sleeper player data
  - filters Sleeper to QB, RB, WR, TE, K, and DEF
  - fetches STANDARD, HALF_PPR, and PPR ADP from FFC
  - matches FFC ADP records deterministically to canonical Sleeper players
  - reports unmatched and ambiguous records before persistence
  - persists Player and PlayerAdp data atomically using batched writes
  - maintains exactly one PlayerAdp row per `(playerId, format)`, using null ADP when no current match exists
  - seed reruns are idempotent
- Sleeper live-contract handling updated for omitted DEF `search_rank` values
- Unicode diacritic normalization added for cross-source player-name matching
- Seed-pipeline test suite expanded to 48 passing tests
- 2026 production-like seed verified successfully:
  - 4,262 fantasy-relevant Sleeper players persisted
  - STANDARD: 205/205 FFC entries matched
  - HALF_PPR: 208/208 FFC entries matched
  - PPR: 256/256 FFC entries matched
  - zero unmatched records
  - zero ambiguous records
  - 12,786 PlayerAdp rows persisted (4,262 players × 3 scoring formats)
  - zero duplicate `(playerId, format)` rows
  - second seed run produced unchanged row counts, confirming idempotency
- Authenticated `/players` verification route implemented
- Authenticated application code verified to query PPR PlayerAdp records with related Player data through Prisma
- Phase 1 exit criterion satisfied
- Phase 2 Milestone 2.1 — authenticated league creation:
  - added authenticated `POST /api/leagues` Route Handler
  - added strict Zod validation for league-creation request bodies
  - league name is trimmed and constrained to 1–50 characters
  - roster size is constrained to 8–25 with a default of 16
  - pick timer is constrained to 10–300 seconds with a default of 60
  - supported scoring formats remain `STANDARD`, `HALF_PPR`, and `PPR`
  - supported draft types remain `SNAKE` and `LINEAR`
  - unknown request fields are rejected rather than silently stripped
  - invalid request bodies return `400`; unauthenticated requests return `401`
  - `ownerId`, `userId`, and `draftSlot` are server-controlled and never accepted from the client
  - league ownership is derived exclusively from the authenticated Auth.js session
  - League and creator LeagueMember are created atomically in one Prisma interactive transaction
  - league creator is automatically assigned `draftSlot = 1`
  - explicit league-creation response DTO implemented instead of returning a raw Prisma object
  - minimal authenticated `/leagues/new` creation UI implemented for verification
- Phase 2 testing foundation:
  - added Vitest configuration for `apps/web`
  - added dedicated `fantasy_draft_test` PostgreSQL database for integration tests
  - added Docker initialization for automatically creating the test database on fresh Postgres volumes
  - test `DATABASE_URL` is loaded into `process.env` before `@fdm/database` initializes
  - destructive test cleanup hard-fails unless connected specifically to `fantasy_draft_test`
  - web test files run serially because they currently share the same physical test database
  - league-creation schema, route, and real-Postgres integration tests implemented
  - 25 web test cases passing across 3 test files
- Milestone 2.1 verification completed:
  - authenticated league creation verified through the running application
  - persisted League and LeagueMember rows verified directly in the development PostgreSQL database
  - creator ownership and `draftSlot = 1` verified
  - unauthenticated league creation verified to return `401`
  - authenticated invalid league input verified to return `400`
  - authenticated attempts to submit server-controlled `ownerId` / `draftSlot` fields verified to return `400`
  - workspace typecheck and build pass
- Phase 2 Milestone 2.2 — Invite Code + Join:
  - added `League.inviteCode` as a required unique field
  - added `League.teamCount` as the league manager/team capacity, distinct from `rosterSize`
  - `teamCount` validation: integer 4–20, default 12
  - invite codes are 8 uppercase characters from `ABCDEFGHJKMNPQRSTUVWXYZ23456789`
  - invite-code input is trimmed and normalized to uppercase
  - invite-code validation uses the exact settled alphabet; ambiguous characters `0`, `1`, `I`, `L`, and `O` are rejected
  - invite-code generation uses Node `crypto.randomInt`
  - invite-code uniqueness is enforced by the database and creation retries invite-code collisions up to 5 times
  - added authenticated `POST /api/leagues/join`
  - join requests accept only `{ inviteCode }`; `userId`, `leagueId`, and `draftSlot` remain server-controlled
  - joining user identity is derived exclusively from the authenticated Auth.js session
  - well-formed unknown invite codes return `404`
  - duplicate membership returns `409`
  - full leagues return `409`
  - league joins run inside a Prisma interactive transaction
  - the target League row is locked with `SELECT ... FOR UPDATE` before duplicate, capacity, and slot checks
  - concurrent joins for the same league are serialized without blocking joins to unrelated leagues
  - joining members receive the lowest available positive `draftSlot` in `1..teamCount`
  - slot assignment fills gaps rather than assuming `memberCount + 1`
  - existing DB unique constraints on `(leagueId, userId)` and `(leagueId, draftSlot)` remain the final integrity backstops
  - `P2002` handling is constraint-specific:
    - `(leagueId, userId)` → already-member conflict
    - `(leagueId, draftSlot)` → join-conflict `409`
    - unrelated unique errors are not silently reclassified
  - `/leagues/new` now exposes `teamCount` and displays the generated invite code
  - added minimal authenticated `/leagues/join` UI
- Milestone 2.2 database migration:
  - added `teamCount` and `inviteCode` through a checked-in Prisma migration
  - existing League rows were backfilled with `teamCount = 12`
  - existing League rows received collision-checked invite codes using the same application alphabet
  - the same migration was applied to `fantasy_draft` and `fantasy_draft_test`
- Milestone 2.2 testing and verification:
  - 59 `apps/web` tests passing
  - join integration tests run against real PostgreSQL in `fantasy_draft_test`
  - concurrent-capacity test verifies a 4-team league never exceeds 4 members and produces slots `{1,2,3,4}`
  - concurrent same-user join test verifies exactly one membership is created
  - gap-fill test verifies occupied slots `{1,2,4}` assign the next member slot `3`
  - duplicate join manually verified through the running application to return HTTP `409`
  - dev database verified to retain exactly one creator membership after the failed duplicate join
  - workspace typecheck and build pass
- Phase 2 Milestone 2.3 — League Detail + Members:
  - added read-only league detail service `getLeagueDetail(leagueId, requestingUserId)`
  - league detail access is restricted to current `LeagueMember`s
  - nonexistent leagues and authenticated non-member access intentionally collapse to the same not-found result
  - authorization is enforced directly in the Prisma query predicate using league membership
  - league detail is loaded with one Prisma query; no N+1 member/user reads
  - member list is ordered by `draftSlot` ascending
  - explicit `LeagueDetailResult` DTO implemented instead of returning raw Prisma records
  - league detail exposes only safe user-facing fields (`id`, `name`, `image`); user email and Auth.js persistence data are not exposed
  - invite code is visible to all current LeagueMembers
  - commissioner/owner identity is derived from `League.ownerId`
  - added read-only `/leagues/[leagueId]` Server Component page
  - successful league creation and join flows now link to the league detail page
  - no GET Route Handler was added; the Server Component calls the server-side service directly
- Milestone 2.3 testing and verification:
  - added real-Postgres integration tests for league-detail access and DTO behavior
  - owner and non-owner LeagueMember access covered
  - authenticated non-member and nonexistent league both verified to return no detail result
  - member ordering by `draftSlot` verified
  - DTO field allowlist verified to prevent accidental User-field expansion
  - invite-code visibility for non-owner members verified
  - page-wiring tests cover unauthenticated, authorized, non-member, and nonexistent branches
  - `notFound()` tests use a local sentinel mock instead of depending on Next.js internal error/digest behavior
  - 70 `apps/web` tests passing
  - workspace typecheck and build pass
  - manual browser verification completed for owner detail view, member/settings rendering, nonexistent-league 404, signed-out fallback, and matching dev-database state
- Phase 2 Milestone 2.4 — Commissioner Settings + Draft-Slot Management:
  - added commissioner-only `PATCH /api/leagues/[leagueId]` for league settings
  - added commissioner-only `PUT /api/leagues/[leagueId]/members/order` for full draft-slot reordering
  - commissioner authority is derived from `League.ownerId`
  - unauthenticated commissioner mutations return `401`
  - nonexistent league and authenticated non-member access collapse to `404`
  - authenticated LeagueMember who is not the owner receives `403`
  - commissioner authorization is enforced server-side inside the same transaction as the mutation
  - shared `authorizeLeagueOwner(...)` helper locks the target League row with `SELECT ... FOR UPDATE` before authorization/invariant checks
  - league settings PATCH uses strict Zod validation with optional fields and no creation defaults
  - empty settings PATCH bodies are rejected
  - unknown settings fields are rejected
  - editable pre-draft settings: `name`, `rosterSize`, `teamCount`, `timerSeconds`, `scoringFormat`, `draftType`
  - `ownerId` remains server-controlled and invite codes remain immutable
  - `teamCount` decreases are rejected if the requested value is below either:
    - current LeagueMember count
    - highest occupied `draftSlot`
  - settings updates never auto-reorder or compact draft slots
  - draft-slot reorder API accepts the desired full order as `{ memberIds: string[] }`
  - reorder uses `LeagueMember.id` as the canonical mutation key
  - submitted member IDs must be an exact permutation of current league membership
  - duplicate, missing, unknown, or foreign-league membership IDs are rejected
  - final draft slots are always derived server-side as contiguous `1..N`
  - reorder is atomic and preserves LeagueMember IDs
  - reorder avoids transient `(leagueId, draftSlot)` unique-constraint collisions with a two-phase negative-slot update inside one transaction
  - joins, settings updates, and reorders all serialize on the same locked League row
  - concurrent commissioner operations are last-writer-wins where appropriate while preserving database invariants
- Milestone 2.4 testing and verification:
  - added real-Postgres tests for commissioner settings, authorization, draft-slot reordering, rollback behavior, and concurrency
  - simultaneous reorders verified to preserve one complete submitted order with no mixed/corrupted slot state
  - reorder-vs-join race verified for both valid serialized outcomes
  - `teamCount` decrease-vs-join boundary race verified to prevent `memberCount > teamCount`
  - team-count floor verified against both member count and highest occupied draft slot
  - 125 `apps/web` tests passing
  - workspace typecheck and build pass
  - manual verification completed for owner-only controls, successful settings persistence, unauthenticated `401`, nonexistent-league `404`, and dev-database persistence
  - non-owner `403`, multi-member reorder behavior, and team-count edge cases are covered by real-Postgres automated tests
- Phase 2 Milestone 2.5 — Final Phase Verification:
  - audited the complete Phase 2 league-management implementation against `CLAUDE.md` and found no repository/documentation drift
  - verified the complete Phase 2 authorization matrix across unauthenticated users, authenticated non-members, LeagueMembers, and league owners
  - audited all Phase 2 HTTP/domain-error mappings for consistent `400`, `401`, `403`, `404`, `409`, and unexpected `500` behavior
  - audited Phase 2 database/application invariants:
    - `(leagueId, userId)` membership uniqueness is DB-enforced
    - `(leagueId, draftSlot)` uniqueness is DB-enforced
    - invite-code uniqueness is DB-enforced
    - `teamCount`, slot-range, contiguous reorder, and capacity invariants are application-enforced behind the shared League-row serialization lock
    - transactional mutations leave no partial state on failure
  - audited all five important real-Postgres concurrency scenarios:
    - concurrent joins near capacity
    - concurrent duplicate joins by the same user
    - simultaneous commissioner reorders
    - reorder racing with join
    - `teamCount` decrease racing with join
  - confirmed league DTOs expose explicit response shapes rather than arbitrary Prisma records
  - confirmed User email and Auth.js persistence fields are not exposed by league/member DTOs
  - confirmed no Phase 3 draft/socket/Redis functionality was introduced during Phase 2
  - final `apps/web` suite passes: 13 test files / 125 tests
  - workspace-wide typecheck passes
  - workspace-wide build passes
  - Prisma migration status is clean/up to date
  - final single-account browser verification passed for create, invite-code display, league detail, duplicate join rejection, commissioner settings, reorder controls, signed-out fallback, nonexistent-league handling, and persisted dev-database state
  - multi-user authorization and concurrency behavior are verified by real-Postgres automated tests rather than requiring additional OAuth accounts
- Milestone 2.5 test-harness fix:
  - final verification exposed an environment-precedence issue in the `apps/web` test command
  - direnv exports the development `DATABASE_URL`, and Node `--env-file=.env.test` does not override an already-existing environment variable
  - the existing `assertUsingTestDatabase()` safety guard correctly prevented destructive test cleanup from running against `fantasy_draft`
  - `apps/web` test script now unsets inherited `DATABASE_URL` before loading `.env.test`
  - normal `pnpm --filter @fdm/web test` now deterministically targets `fantasy_draft_test` even when the parent shell points at the development database
  - the test-database safety guard remains unchanged and mandatory
- Phase 3 Milestone 3.1 — Draft Start:
  - added commissioner-only `POST /api/leagues/[leagueId]/draft`
  - a League has at most one Draft, enforced by existing `Draft.leagueId @unique`
  - draft creation and start are a single operation; no separate PENDING creation flow exists
  - successful draft start creates the Draft directly as `ACTIVE`
  - starting a draft requires the League to be completely filled: `memberCount === teamCount`
  - draft start derives commissioner authority exclusively from `League.ownerId`
  - unauthenticated draft start returns `401`
  - nonexistent league / authenticated non-member returns `404`
  - authenticated LeagueMember who is not the owner returns `403`
  - underfilled league returns `409`
  - starting a league that already has a Draft returns `409`
  - draft start runs inside a Prisma interactive transaction
  - the League row is locked with `SELECT ... FOR UPDATE` before draft-state checks
  - concurrent start attempts serialize on the League row; exactly one Draft may be created
  - Draft creation initializes:
    - `status = ACTIVE`
    - `currentPickNumber = 1`
    - `currentUserId` to the user occupying the computed first draft slot
    - `turnDeadline` from server time plus `League.timerSeconds`
  - missing first-picker state is treated as an internal invariant failure rather than silently asserted
  - explicit `StartDraftResult` DTO implemented; no arbitrary Prisma record is returned
- Phase 3 shared draft-order foundation:
  - added pure `getPickerForPickNumber(pickNumber, numTeams, draftType)` to `packages/shared`
  - supported draft types are structurally represented as `"SNAKE" | "LINEAR"` in shared domain logic
  - `packages/shared` remains persistence-independent and does not depend on `@fdm/database`
  - LINEAR order wraps `1..N` every round
  - SNAKE order reverses direction at round boundaries
  - invalid non-positive/non-integer pick numbers or team counts fail explicitly
- Phase 3 draft-state mutation guard:
  - once a Draft exists for a League, commissioner league-settings mutations return `409`
  - once a Draft exists for a League, draft-slot reorder mutations return `409`
  - league settings are not snapshotted onto Draft in the current design
  - League remains the source of draft configuration
  - pre-draft settings/reorder and draft start share the same League-row serialization point
  - `DraftStatus.PAUSED` remains unused/dormant
- Milestone 3.1 testing and verification:
  - `apps/web`: 16 test files / 156 tests passing
  - `packages/database`: 51 tests passing
  - pure pick-order tests cover SNAKE and LINEAR round boundaries and invalid input
  - real-Postgres start-draft integration tests cover successful SNAKE/LINEAR start, authorization, underfilled league, duplicate start, first-picker assignment, and deadline persistence
  - concurrent double-start test verifies exactly one Draft row is created
  - existing settings/reorder tests verify Draft existence locks those mutations with `409`
  - workspace-wide typecheck passes
  - web build passes with `/api/leagues/[leagueId]/draft` registered
  - manual verification confirmed underfilled owner start returns `409` and creates no Draft row
  - manual verification confirmed pre-draft settings and reorder behavior remain unaffected
  - successful full-league start and multi-user authorization/concurrency behavior are verified through the real-Postgres automated suite
- Phase 3 Milestone 3.2 — Transactional Pick Submission:
  - added `POST /api/leagues/[leagueId]/draft/picks`
  - request body is strict `{ playerId: string }`
  - client cannot supply `userId`, `draftId`, `pickNumber`, `wasAutopick`, turn state, or deadline state
  - core Prisma-dependent mutation service is `apps/web/lib/drafts/submit-pick.ts`
  - the HTTP Route Handler is a thin adapter over the framework-independent service
  - requester must be authenticated and a current `LeagueMember`
  - Draft must exist and have `status = ACTIVE`
  - requester must equal `Draft.currentUserId`
  - manual submissions persist `wasAutopick = false`
  - selected `Player` must exist and must not already be drafted in the Draft
  - Draft row is locked with `SELECT ... FOR UPDATE` before mutable turn-state validation
  - successful submission atomically creates exactly one Pick and advances Draft state
  - concurrent submissions for the same turn serialize on the Draft row
  - after one request consumes a turn, stale concurrent requests fail the current-picker check rather than advancing again
  - non-final picks increment `currentPickNumber`, derive the next picker with `getPickerForPickNumber`, update `currentUserId`, and assign a new server-owned `turnDeadline`
  - `totalPicks = League.teamCount * League.rosterSize`
  - final pick transitions the Draft to `COMPLETE`
  - completed Draft retains `currentPickNumber = totalPicks`
  - completed Draft sets `currentUserId = null` and `turnDeadline = null`
  - `@@unique([draftId, playerId])` is the database backstop against drafting a Player twice
  - `@@unique([draftId, pickNumber])` is the database backstop against multiple Picks owning one overall pick number
  - no schema migration was required
  - no Socket.IO, Redis, timer-expiry processing, autopick selection, reconnect behavior, or draft-room UI was introduced
- Milestone 3.2 verification:
  - `apps/web`: 18 test files / 181 tests passing
  - `packages/database`: 5 test files / 51 tests passing
  - workspace-wide typecheck passes
  - web build passes with `/api/leagues/[leagueId]/draft/picks` registered
  - real-Postgres tests verify SNAKE progression across round boundaries
  - real-Postgres tests verify LINEAR progression
  - real-Postgres tests verify final-pick completion
  - real-Postgres tests verify deadline advancement
  - 20 simultaneous same-turn submissions persist exactly one Pick and advance the Draft exactly once
  - concurrent submissions using different Players still consume the turn exactly once
  - player-uniqueness and pick-number-uniqueness DB constraints are tested independently
  - manual verification confirmed no-Draft requests return `404`
  - manual verification confirmed malformed requests return `400`
  - manual verification confirmed rejected requests leave Draft/Pick state unchanged
  - successful multi-user and concurrency paths remain automated real-Postgres verification because the local OAuth setup has only one real account
- Phase 3 Milestone 3.3a — Shared Draft Service Boundary + Socket Authentication Foundation:
  - moved shared Prisma-dependent `submitPick` behavior from `apps/web` into `packages/database`
  - moved shared draft/league service errors into `packages/database`
  - moved shared real-Postgres test-support helpers into `@fdm/database/test-support`
  - preserved `submitPick` transaction behavior while changing only its package/import boundary
  - HTTP pick submission continues to validate transport input inside `apps/web` before calling the shared persistence service
  - `apps/web/lib/drafts/schema.ts` remains web-owned; transport validation was not moved into the database package
  - added `getDraftState` and `getDraftStateForLeague` as shared authoritative draft-state queries
  - draft-state DTOs are explicit transport-independent shapes and do not expose generated Prisma model types
  - authorized draft-state lookup collapses nonexistent League and authenticated non-member to the same inaccessible/null result
  - draft-state results include League draft configuration, ordered members, current Draft state, and Picks ordered by `pickNumber` with safe Player display fields
  - added persisted `SocketTicket` authentication primitive
  - socket tickets are random UUID tokens with a 15-second lifetime
  - socket tickets are single-use
  - ticket consumption is an atomic conditional Postgres update
  - unknown, expired, and already-consumed tickets all fail identically
  - added authenticated `POST /api/socket/ticket`
  - authenticated requests mint a ticket and return `201`
  - unauthenticated requests return `401` and mint nothing
  - no Socket.IO behavior was implemented in 3.3a
  - `apps/socket-server` remained functionally unchanged
  - no Redis, presence, timer-expiry processing, autopick, cross-process broadcast bridge, or new workspace package was introduced
- Milestone 3.3a verification:
  - `apps/web`: 19 test files / 183 tests passing
  - `packages/database`: 7 test files / 59 tests passing
  - workspace-wide typecheck passes
  - workspace-wide build passes
  - `SocketTicket` migration applied successfully to both `fantasy_draft` and `fantasy_draft_test`
  - real-Postgres tests verify ticket expiration
  - real-Postgres tests verify single-use ticket consumption
  - concurrent consumption of one ticket produces exactly one success
  - existing transactional pick/concurrency tests remain passing after the service move
  - manual authenticated `POST /api/socket/ticket` verified `201` with token/expiration
  - manual unauthenticated `POST /api/socket/ticket` verified `401`
- Phase 3 Milestone 3.3b — Socket.IO Draft Protocol + Realtime Integration:
  - replaced the placeholder `apps/socket-server` HTTP process with a real typed Socket.IO server
  - added fail-loud socket-server environment validation
  - added configurable `SOCKET_CORS_ORIGIN`
  - added client-visible `NEXT_PUBLIC_SOCKET_SERVER_URL` for the browser Socket.IO connection
  - Socket.IO handshake authentication consumes the short-lived, single-use `SocketTicket` created by the authenticated web endpoint
  - authenticated socket identity is stored server-side and is never accepted from client event payloads
  - strict socket payload validation rejects unknown fields, including attempted client-supplied identity
  - added `draft:join` with server-side League membership authorization
  - authorized joins place the socket in a `league:${leagueId}` room and return current authoritative draft state
  - nonexistent/inaccessible Leagues collapse to `LEAGUE_NOT_ACCESSIBLE`
  - added `draft:pick` using the shared `@fdm/database` `submitPick` service
  - socket pick handling does not duplicate pick transaction, turn-order, or locking logic
  - socket pick failures use acknowledgement error codes; no standalone `pick:rejected` event
  - accepted picks trigger a fresh authoritative state read and one `draft:state` broadcast to the League room
  - the same `draft:state` event represents normal advancement and draft completion
  - no separate `draft:complete` event is required because completion is represented in authoritative Draft state
  - moved persistence-independent `DraftStateResult`, `DraftStateMember`, `DraftStatePick`, and related DTO unions into `packages/shared`
  - `packages/database` retains all Prisma selects/query/mapping logic and returns the shared DTO types
  - added a minimal `/leagues/[leagueId]/draft` browser harness for realtime integration/manual verification
  - reconnects mint a fresh SocketTicket, reconnect, rejoin, and obtain current authoritative state
  - multiple sockets for the same authenticated user are supported independently
  - added graceful Socket.IO/Prisma shutdown handling
  - HTTP-originated picks remain authoritative but do not immediately publish to Socket.IO rooms in 3.3b
  - no Redis, presence, chat, timer-expiry processing, autopick, HTTP-to-socket broadcast bridge, pause/resume, or undo was introduced
- Milestone 3.3b verification:
  - `apps/socket-server`: 4 test files / 23 tests passing
  - `packages/database`: 7 test files / 59 tests passing
  - `apps/web`: 20 test files / 187 tests passing
  - workspace-wide typecheck passes
  - workspace-wide build passes
  - real-Postgres socket tests cover ticket authentication and replay/concurrency rejection
  - socket join tests cover membership authorization, strict payload validation, and multiple sockets for one user
  - socket pick tests cover accepted/rejected picks and authoritative broadcasts
  - shared-service-vs-socket race proves exactly one caller can consume a turn
  - socket-vs-socket race proves exactly one socket can consume a turn
  - manual browser verification confirmed ticket mint → socket authentication → ticket consumption → room join → authoritative state restoration
  - manual refresh verification confirmed a fresh SocketTicket is minted and authoritative state is restored
  - manual two-tab verification confirmed independent simultaneous sockets for the same authenticated user
  - socket server remained error-free during solo-reachable manual verification
- Phase 3 Milestone 3.4 — Server-Owned Timers + Autopick:
  - added a single recurring turn-expiration sweep owned by `apps/socket-server`, not one timer per Draft
  - the sweep is a self-rescheduling `setTimeout`, not `setInterval`: the next tick is only scheduled after the current `runSweepOnce()` promise settles, so ticks can never overlap
  - production sweep interval defaults to 2000ms (`DEFAULT_SWEEP_INTERVAL_MS`); `startTurnSweep(io, { intervalMs })` accepts an override used only by tests
  - the sweep is started from `index.ts`'s real process lifecycle (after `httpServer.listen`) and stopped on `SIGINT`/`SIGTERM`, not from `createSocketServer()` — so tests building a server via `createSocketServer()`/`startTestServer()` never silently inherit a live background DB-polling interval
  - graceful shutdown calls `stopTurnSweep()` before closing Socket.IO and disconnecting Prisma
  - each tick discovers candidates with a plain, unlocked `findExpiredActiveDraftLeagueIds()` read (`Draft.status = ACTIVE AND turnDeadline <= now`)
  - restart recovery needs no in-memory timer reconstruction: a freshly started process rediscovers exactly the same expired/future deadlines a long-running process would, because discovery is a live Postgres read
  - a Draft whose deadline is still in the future simply becomes eligible on a later tick
  - the sweep processes Drafts correctly with zero connected Socket.IO clients
  - `processExpiredDraftTurn` is the autopick counterpart to `submitPick`: it locks the same Draft row (`lockDraftForLeague`, `SELECT ... FOR UPDATE`) and re-checks expiry *inside* the lock
  - a stale/no-op candidate (turn already consumed by a manual pick or another sweep pass, Draft no longer `ACTIVE`, deadline no longer past) returns a `"skipped"` outcome rather than throwing or double-picking
  - manual picks and autopicks serialize on the identical Draft-row lock, so a manual-pick-vs-autopick race and a duplicate-sweep-vs-sweep race both resolve to exactly one turn consumer
  - manual and automatic picks share the same internal `applyPick(...)` Pick-insert/completion/turn-advance logic, differing only in `wasAutopick` and player selection
  - `submitPick` and `processExpiredDraftTurn` are the two public pick-correctness services; `lockDraftForLeague`, `applyPick`, and `selectAutopickPlayerId` are internal `@fdm/database` implementation details, not part of the public surface
  - Postgres remains the sole authoritative correctness boundary
  - autopick selection (`selectAutopickPlayerId`) persists `Pick.wasAutopick = true` and is two-tier: lowest available `PlayerAdp.adp` for the League's scoring format, falling back to lowest `Player.searchRank` (nulls last) with `id asc` as a final deterministic tiebreak
  - already-drafted Players are excluded by both selection queries
  - no roster-position enforcement exists yet; selection is position-agnostic
  - an exhausted undrafted-Player pool throws `AutopickExhaustedError`, treated as an internal data/configuration invariant failure — logged and left for a later sweep tick rather than crashing the sweep for other leagues
  - post-autopick turn progression uses the same shared `getPickerForPickNumber` SNAKE/LINEAR logic as manual picks
  - the final autopick of a Draft transitions it to `COMPLETE` with `currentUserId = null` and `turnDeadline = null`, identically to a final manual pick
  - a successful autopick re-reads authoritative state and broadcasts one full `draft:state` snapshot to `league:${leagueId}` via `broadcastDraftState(...)`, the same helper accepted socket manual picks use
  - a stale/no-op sweep pass does not broadcast
  - Socket.IO remains a delivery mechanism; it is not part of the correctness boundary
- Milestone 3.4 verification:
  - `packages/database`: 8 test files / 75 tests passing
  - `apps/web`: 20 test files / 187 tests passing (before the later `/leagues` index page and its tests)
  - `apps/socket-server`: 5 test files / 30 tests passing
  - workspace-wide typecheck passes
  - database, socket-server, and web builds pass with required development environment variables loaded
  - automated coverage includes: normal autopick and `wasAutopick` persistence, SNAKE/LINEAR progression after autopick, deadline advancement, final-autopick completion, stale-timer no-op (already manually picked, not-yet-expired, no-Draft, already-`COMPLETE`), a manual-pick-vs-autopick race resolving to exactly one accepted pick, a concurrent autopick-vs-autopick race resolving to exactly one Pick, deterministic ADP-then-searchRank player selection, already-drafted-Player exclusion, the exhausted-player-pool invariant (`AutopickExhaustedError`), expired-draft discovery including a restart-recovery shape (an already-expired draft is processed on the very first sweep tick of a freshly started process), autopick processing with zero connected clients, authoritative `draft:state` broadcast on a successful autopick, no broadcast on a no-op sweep pass, and sweep start/stop/self-rescheduling behavior
  - solo-reachable manual verification: socket server started with the real 2000ms sweep; the Draft Room harness still authenticated, joined, and resynced correctly with the sweep running; browser refresh minted a fresh SocketTicket and restored authoritative state; process shutdown stopped the sweep and exited cleanly
  - ACTIVE-draft timer-expiry, autopick, and race behavior were intentionally verified through the automated real-Postgres suite above rather than through fake local identities or manual database corruption, since the local OAuth setup has only one real account
- `/leagues` navigation index page:
  - lists every League where the authenticated user has a `LeagueMember` row
  - `LeagueMember` membership is the sole source of truth for both owned and joined Leagues; there is no separate `ownerId` query
  - `getMyLeagues(userId)` in `apps/web/lib/leagues/get-my-leagues.ts` returns an explicit `MyLeagueSummary[]` DTO rather than exposing raw Prisma rows
  - each listed League links to `/leagues/[leagueId]`
  - Leagues the user owns show a commissioner indication
  - basic League metadata is shown: name, team count, scoring format, draft type
  - Create League and Join League navigation is always available
  - the empty state (no Leagues) links to `/leagues/new` and `/leagues/join`
  - unauthenticated access follows the same inline GitHub sign-in fallback used by the other league pages
  - added as a small navigation feature, not a Phase 3 milestone; introduces no new API route and no schema change
- `/leagues` verification:
  - `apps/web`: 22 test files / 194 tests passing
  - workspace-wide typecheck passes
  - workspace-wide build passes with `/leagues` registered
  - manual verification confirmed an existing created League appears with correct commissioner indication and metadata, its detail link works, Create/Join navigation works, and signed-out access shows the normal sign-in fallback
- Phase 4 Milestone 4.1 — Commissioner Draft Start UI:
  - `/leagues/[leagueId]` no longer exposes an unconditional Draft Room link
  - `getLeagueDetail` now exposes minimal draft existence as `draft: { id: string } | null`
  - draft `status` was deliberately not added to this DTO — 4.1 only needs existence; a later milestone can extend the shape if it actually needs more
  - commissioner + no Draft + underfilled league renders a disabled Start Draft control with `X/Y joined` membership progress
  - commissioner + no Draft + full league renders an enabled Start Draft action
  - non-commissioner + no Draft renders status messaging only; no start control is rendered for any non-owner
  - an existing Draft renders an "Enter draft room" link instead of any start action, for any role
  - added `apps/web/app/leagues/[leagueId]/start-draft-form.tsx`, a small client component and the only new UI surface this milestone introduces
  - `StartDraftForm` calls the existing `POST /api/leagues/[leagueId]/draft` endpoint unchanged; no second draft-start path was introduced
  - a pending state disables the control and prevents double submission while the request is in flight
  - successful start navigates via `router.push` into `/leagues/[leagueId]/draft`
  - errors are presented as short user-facing copy mapped from HTTP status, not as a raw JSON/error-body dump
  - the endpoint's ambiguous `409` (shared by `DraftAlreadyExistsError` and `LeagueNotFullError`, with no structured code to tell them apart) is not parsed from the error string; the UI reports that draft state changed and calls `router.refresh()` so the server component re-fetches authoritative league state
  - server-side `startDraft` authorization, transaction, and correctness behavior is unchanged and remains authoritative; this milestone is UI-only
  - no Socket.IO, Phase 3 draft-engine, schema, `packages/shared`, or `packages/database` changes were required
  - no new frontend global state-management infrastructure was introduced
- Milestone 4.1 verification:
  - `apps/web`: 22 test files / 200 tests passing
  - `packages/database`: 8 test files / 75 tests passing
  - `apps/socket-server`: 5 test files / 30 tests passing
  - workspace-wide typecheck passes
  - workspace-wide build passes with the normal required environment variables loaded
  - real-Postgres tests cover the new `getLeagueDetail` `draft` field (null with no Draft; populated after a real `startDraft` call) and the page's four meaningful render branches (commissioner-not-full, commissioner-full, non-commissioner, Draft-exists), inspected via the page's own returned React element tree rather than a new component-rendering test stack
  - `StartDraftForm`'s own fetch/pending/navigation interaction has no automated test, consistent with the existing unverified-by-automation precedent for `create-league-form.tsx`, `league-settings-form.tsx`, `member-order-form.tsx`, and `join-league-form.tsx`
  - manual verification confirmed, on an owned underfilled league with no Draft: the Start Draft control renders, is disabled while underfilled, shows the correct `X/Y joined` values, and does not issue a POST request when interacted with while disabled
  - manual verification confirmed existing league-detail functionality and `/leagues` → league-detail navigation are unaffected
  - the enabled/successful start path, non-commissioner rendering, existing-Draft rendering, authorization/error branches, and concurrency behavior remain covered by the automated real-Postgres suite rather than manufactured manual state — `teamCount` has a minimum greater than one (currently 4), membership uniqueness prevents one account from filling multiple slots, and no fake identities or dev-database seeding were used to work around this
- Phase 4 Milestone 4.2 — Draft Room Shell + Live Turn State:
  - `DraftRoomPage` now passes the authenticated `session.user.id` into `DraftRoomClient` as `currentUserId`
  - `DraftRoomClient` remains the single owner of the Socket.IO connection and the authoritative `DraftStateResult`; no second draft-state model was introduced
  - `draft:join` ack and `draft:state` events continue to replace the authoritative snapshot wholesale, unchanged from 3.3b
  - no Redux, Zustand, Context, or reducer was introduced; current-picker name, `"your turn"`, draft phase, and countdown display are all derived at render time rather than stored
  - current picker name is derived from authoritative `state.members` + `state.draft.currentUserId`, with a safe fallback for an unmatched `currentUserId`
  - `"your turn"` is derived from authoritative state + authenticated `currentUserId`; it is not stored separately
  - the draft room now presents human-readable no-Draft / ACTIVE / COMPLETE state instead of a raw debug dump of `currentUserId` and status fields
  - added pure, DOM-free helpers in `draft-room-helpers.ts` (`getDraftPhase`, `getCurrentPickerName`, `isYourTurn`, `getMsRemaining`, `formatCountdown`) and two small presentational components, `ConnectionStatusBadge` and `TurnBanner`
  - connection presentation now supports `"connecting" | "connected" | "reconnecting" | "error"`, and the last authoritative snapshot remains rendered through a temporary disconnect rather than being cleared
  - the existing reconnect architecture is unchanged: fresh SocketTicket → reconnect → `connect` → `draft:join` → authoritative resync
  - Socket.IO's Manager-level reconnect events (`reconnect_attempt`, `reconnect_failed`) are registered on `socket.io`, not `socket`, per the installed socket.io-client 4.8.3 `SocketReservedEvents`/`ManagerReservedEvents` split — verified against the installed source rather than assumed
  - `socket.active` (a documented public property cleared by `Socket.destroy()`) distinguishes a `connect_error`/`disconnect` Socket.IO will keep retrying on its own (a transport-level failure) from one where it has permanently stopped (a handshake `CONNECT_ERROR` from a rejected SocketTicket, or `"io server disconnect"`) — verified against the installed socket.io-client source: a rejected ticket's `CONNECT_ERROR` packet calls `Socket.destroy()`, which, since this app has only one namespace socket, makes the Manager set `skipReconnect = true` and give up for good with no further event ever firing
  - ticket-mint rejection inside the Socket.IO `auth` callback is caught and maps to the `"error"` connection state; no unhandled Promise rejection occurs
  - client countdown is presentation-only: authoritative `turnDeadline` plus a local `now` tick (updated roughly once per second, only while an ACTIVE draft has a deadline) derive `msRemaining` via `getMsRemaining`; `msRemaining` itself is not stored, and a new authoritative deadline updates the display automatically with no manual reset logic
  - the countdown clamps at `0:00` and never advances the draft, triggers autopick, mutates authoritative state, or disables anything based only on the local clock
  - the temporary manual player-ID pick form remains, relabeled as a clearly-marked debug/development control, until Milestone 4.4 replaces it with production pick UX
  - no available-player board/search/filtering (4.3), no production pick-selection UX (4.4), and no draft board/roster UI (4.5) were implemented
  - no Tailwind or other global styling infrastructure was added; styling uses only inline `style` props already available in the existing unstyled pages — Tailwind is named in this file's Stack table but was never actually installed anywhere in the repository, which is a documentation/styling-system decision to revisit later, not a claim that Tailwind currently exists
  - no Phase 3 engine/protocol/database correctness behavior changed
- Milestone 4.2 verification:
  - `apps/web`: 23 test files / 219 tests passing
  - `packages/database`: 8 test files / 75 tests passing
  - `apps/socket-server`: 5 test files / 30 tests passing
  - workspace-wide typecheck passes
  - workspace-wide build passes with the required environment variables loaded
  - new deterministic unit tests cover draft phase (no-Draft/ACTIVE/COMPLETE), current-picker name resolution including an unmatched-`currentUserId` fallback, `"your turn"` derivation, `getMsRemaining` for null/future/past deadlines, and `formatCountdown` including zero-clamping and floor-not-round behavior
  - `page.test.ts` was extended to verify `currentUserId` is threaded from the authenticated session into `DraftRoomClient`'s own returned element, without a rendering/DOM test stack
  - manual verification confirmed, on the one real account's own league with no Draft: direct navigation to `/leagues/[leagueId]/draft` renders the shell correctly, "Draft has not started yet" renders, the authenticated member is marked `(you)`, raw current-user-ID presentation is gone, and the temporary pick form is clearly labeled as a debug control
  - manual verification confirmed the connection lifecycle: initial "Connecting…" to "Live"; stopping the socket server transitions to "Reconnecting…" while preserving the last authoritative snapshot; restarting the socket server returns to "Live" and resyncs authoritative state without a browser refresh; a page refresh reconnects normally; no unexpected console errors or unhandled Promise rejections were observed across connect/disconnect/reconnect/refresh
  - ACTIVE-draft countdown, current-picker/"your turn" rendering for someone else's turn, COMPLETE-draft rendering, and autopick-driven UI updates could not be legitimately reproduced manually because the development `Draft` table currently contains no Drafts and only one real OAuth identity exists locally; these remain verified through the deterministic unit tests above plus the existing Phase 3 `packages/database`/`apps/socket-server` real-Postgres/real-socket suites rather than through fabricated identities or dev-database seeding
- Phase 4 Milestone 4.3 — Available Players + Search/Filtering:
  - the production draft-room discovery surface currently includes rostered NFL players (`Player.nflTeam IS NOT NULL`); expanding discovery to free agents or other provider records would be a future explicit product/data decision
  - current dev data: 4,262 total `Player` rows; 1,068 rostered rows (`nflTeam IS NOT NULL`) surface in the draft-room pool
  - added `getAvailablePlayers(scoringFormat)` in `apps/web/lib/players/get-available-players.ts` — one server-side fetch per page load, called from `/leagues/[leagueId]/draft`'s Server Component alongside the existing `getDraftState` call
  - no new player-search API route, pagination, virtualization, debounce, or per-keystroke network requests were introduced
  - the fetched player pool is passed into `DraftRoomClient` as a prop and filtered entirely client-side
  - `DraftRoomClient` remains the sole authoritative draft/socket-state owner; the player pool is a separate, independent prop, not folded into `DraftStateResult`
  - drafted player IDs are derived from authoritative `state.picks` via a new pure `getDraftedPlayerIds(state)` helper added to `draft-room-helpers.ts`; no second mutable drafted-player collection was introduced
  - search/position-filter state lives locally inside the new `AvailablePlayersPanel` client component, not in `DraftRoomClient`
  - search is trimmed, case-insensitive, partial `fullName` matching only; team-abbreviation search was intentionally not added
  - position filters are `All | QB | RB | WR | TE | K | DEF`, matching the actual position values present in the data; position filtering remains presentation-only
  - search and position filter combine with AND
  - drafted players are excluded from the available-player list; a new authoritative `draft:state` snapshot naturally updates availability, with no optimistic removal and no new client-side correctness boundary
  - the player table displays Player / Pos / Team / ADP; there is deliberately no Rank column, since a rank derived from the currently filtered result set would misleadingly resemble an overall fantasy ranking
  - missing ADP displays as `—`
  - ADP is selected using the league's own `scoringFormat`, not hardcoded to PPR
  - ordering is ADP ascending (nulls last), then `searchRank` ascending (nulls last), then deterministic `id` ascending — `searchRank` is an ordering input only and is never rendered
  - the query is rooted on `PlayerAdp` (one row per Player per format is a standing seed invariant), filtered to `player.nflTeam IS NOT NULL`, using Prisma 7.9.1's native `{ sort, nulls }` ordering on both a direct field (`adp`) and a nested to-one relation field (`player.searchRank`); this was verified against the installed generated types before implementation, so no fallback ordering implementation was required
  - the `AvailablePlayer` DTO is a narrow web-only DTO in `apps/web/lib/players`, following the same convention as `LeagueDetailResult`/`MyLeagueSummary` — not a raw Prisma model, and not moved into `@fdm/shared` since it never crosses the socket-server transport boundary
  - the old `/players` verification route was left untouched/superseded, not removed
  - the temporary manual `playerId` debug form remains, unchanged, until Milestone 4.4
  - Phase 3 `submitPick` correctness was not modified; Postgres/`submitPick` remains the sole authority on pick validity regardless of what the discovery panel shows
  - no roster-position enforcement or roster-aware filtering was added
- Milestone 4.3 verification:
  - `packages/database` build passed
  - workspace-wide typecheck passed
  - `packages/database`: 75/75 tests passing
  - `apps/web`: 238/238 tests passing (219 prior + 19 new)
  - `apps/socket-server`: 30/30 tests passing (unaffected)
  - workspace-wide build passed with the required development environment variables loaded
  - new test coverage: scoring-format-specific ADP selection, rostered inclusion / `nflTeam: null` exclusion, missing-ADP behavior, deterministic ordering (ADP → searchRank → id), case-insensitive partial search, whitespace/empty search, no-results behavior, position filtering, search+position AND behavior, drafted-player exclusion, drafted-ID derivation from `state.picks`, and server-to-client player-prop threading
  - manual verification was performed using the existing legitimate development OAuth/Auth.js session state; no user or session was fabricated
  - manual verification confirmed the Available Players panel renders before a Draft exists, real rostered players appear with correct Player/Pos/Team/ADP data, search and clearing search work, the DEF filter returns exactly 32 rows matching the dev database, K and DEF are supported position filters, search+position combine correctly, the no-results state renders, clearing all filters restores all 1,068 rostered players, missing ADP renders as `—`, and displayed ADP matched the league's own PPR scoring format
  - the socket server was intentionally not running during this player-discovery verification; the resulting connection-refused console noise was expected and unrelated to 4.3
  - drafted-player disappearance and other ACTIVE-draft live-update behavior remain automated-only, since the development database still has no legitimate ACTIVE Draft; Milestone 4.4 is where the current player rows become the production pick-submission UX, with Draft actions replacing the temporary raw player-ID workflow
- Phase 4 Milestone 4.4 — Production Pick Submission UX:
  - each Available Players row now has a Draft action, replacing the temporary raw `playerId` debug form (removed entirely from the normal production draft-room UI)
  - production draft-room picks submit through the existing Socket.IO `draft:pick` event; the HTTP pick route (`POST /api/leagues/[leagueId]/draft/picks`) is unchanged and is not used by this action, since successful HTTP-originated picks are not bridged into Socket.IO broadcasts and would leave the room stale
  - no Phase 3 protocol shapes changed: `draft:pick`/`draft:join`/`draft:state`/ack contracts are reused exactly as they existed before 4.4
  - Draft buttons are enabled only when `phase === "ACTIVE"`, authoritative state says the authenticated user is `currentUserId`, socket `status === "connected"`, and no client pick request is currently pending — this gating is a UX convenience only; `submitPick`/PostgreSQL remain the sole correctness boundary and still validate/reject independently of what the client believes
  - no optimistic behavior was introduced: no local player removal, pick append, turn advancement, pick-number advancement, `currentUserId` mutation, or deadline prediction
  - a successful `{ ok: true }` pick ack carries no state and does not itself mutate `DraftStateResult`; the subsequent authoritative `draft:state` broadcast (which the submitting socket also receives, since it already joined the League room via `draft:join`) remains the sole success-state update
  - `draft:join`'s ack and the `draft:state` listener both apply authoritative snapshots through one shared `applyAuthoritativeState` function in `DraftRoomClient`, so there is exactly one place authoritative state is ever applied
  - `pendingPlayerId: string | null` is the user-visible pending-submission state
  - a synchronous `pickInFlightRef` (a `useRef`, not `useState`) guards against duplicate `draft:pick` emits from rapid double-clicks landing before React re-renders; this is a UX duplicate-emission guard only and does not replace or weaken the server-side Draft-row lock
  - while one submission is pending, every Draft button is disabled; the selected row shows `Drafting…`, other rows keep showing `Draft`
  - a rejection ack clears `pendingPlayerId`/the in-flight guard and shows a mapped inline error
  - any fresh authoritative state application (join or broadcast) clears stale `pendingPlayerId`/in-flight/error state
  - a socket `disconnect` unconditionally clears `pendingPlayerId`/the in-flight guard without guessing whether the in-flight pick committed; reconnect continues to use fresh ticket → `draft:join` → authoritative resync to determine the truth
  - no automatic pick retry or exactly-once client protocol was added
  - `SocketErrorCode` → user-facing message mapping is exhaustive (`Record<SocketErrorCode, string>`, so a new protocol error code fails to typecheck rather than silently falling through to a generic message) and lives in the pure `pick-submission-helpers.ts`, alongside a pure `canSubmitPick(...)` gating helper — both DOM-free and unit tested without jsdom/React Testing Library
  - no Redux/Zustand/Context/reducer and no toast framework were introduced
  - no changes to `apps/socket-server`, `packages/database`, `packages/shared`, or the HTTP pick route
  - known residual edge, deliberately not addressed in 4.4: the server's current order is commit → `{ok:true}` ack → `draft:state` broadcast; if the commit and success ack both succeed but the subsequent broadcast is somehow lost while the socket remains connected (no `disconnect` fires), the client's pending state would stay stuck with no further signal to clear it — no timeout/forced-resync machinery was added for this in 4.4; it was deferred to Milestone 4.6, which resolved it with a client-initiated `draft:join` resync (see "Pick-success resync (Milestone 4.6)" under "Realtime reconnect behavior")
  - separately, the Available Players table's ADP column now displays a stable integer **ADP Rank** instead of the raw decimal `PlayerAdp.adp` value — computed client-side as each player's 1-indexed position within the full ADP-sorted pool (`computeAdpRanks` in `available-players-helpers.ts`), not by rounding/flooring the raw number
  - persisted `PlayerAdp.adp` and server-side ordering/autopick selection are unchanged; ADP Rank is presentation-only and is always computed from the full unfiltered player pool, so it does not renumber when search/position filters are applied
  - a player with `adp === null` remains unranked and displays `—`, rather than being assigned an invented rank
- Milestone 4.4 verification:
  - `apps/web`: 26 test files / 261 tests passing (256 after the pick-submission-UX work, plus 5 more for the ADP Rank adjustment)
  - `packages/database`: 8 test files / 75 tests passing (unaffected)
  - `apps/socket-server`: 5 test files / 30 tests passing (unaffected)
  - workspace-wide typecheck passes
  - workspace-wide build passes with the required development environment variables loaded, `/leagues/[leagueId]/draft` registered
  - new pure-function test coverage: `canSubmitPick` across no-Draft/COMPLETE/wrong-turn/non-connected-status/pending-request branches; exhaustive `mapPickErrorToMessage` coverage for every `SocketErrorCode`; `computeAdpRanks` ordering from non-integer raw ADPs, null-ADP players left unranked, and rank stability under both position-filter and search-filter scenarios
  - no jsdom/React Testing Library was introduced; `DraftRoomClient`'s actual click→emit→ack→state wiring remains manually/Phase-3-suite verified, consistent with the existing precedent for the other draft-room client components
  - manual verification, using the one legitimate development OAuth identity and no fabricated users/leagues, confirmed: the Available Players panel still renders correctly, a Draft action appears on each row, Draft actions stay disabled in the no-Draft state, the raw player-ID debug form is gone, search/filter behavior is unaffected, connection-state gating (disabled while not connected) works, and socket server stop/restart still resyncs correctly with no unexpected console/runtime errors beyond the expected temporary connection errors during deliberate server shutdown
  - a successful real pick flow, multi-manager turn-based enable/disable, and live rejection-error paths remain automated-only, since the development database still has only one legitimate OAuth identity and no legitimate ACTIVE draft; these remain covered by the existing Phase 3 real-Postgres/real-socket suites plus 4.4's own pure-helper tests
- Phase 4 Milestone 4.5 — Pre-Draft Experience + Live Draft Room:
  - split the previously combined `/leagues/[leagueId]/draft` page into two routes: `/leagues/[leagueId]/draft` (stable pre-draft/draft-summary page) and `/leagues/[leagueId]/draft/room` (live draft room)
  - `/leagues/[leagueId]/draft` never opens a Socket.IO connection; before a Draft exists it renders draft settings, draft order (members in `draftSlot` order), the full empty draft board, a read-only Available Players panel, and the commissioner's Start Draft control
  - once the Draft is `ACTIVE`, `/leagues/[leagueId]/draft` renders a compact "Draft in progress" summary plus a **Join Draft Room** link into `/draft/room`; once `COMPLETE`, a compact "Draft complete" summary plus a **View Draft Room** link
  - `/leagues/[leagueId]/draft/room` redirects back to `/leagues/[leagueId]/draft` (via `redirect()`) when no Draft exists yet; otherwise it renders the existing `DraftRoomClient` unchanged, using the existing SocketTicket → `draft:join` → reconnect/resync → pick-submission flow exactly as it worked before this milestone
  - **Join Draft Room** is navigation only, not a second membership concept — the user is already a `LeagueMember`; no new "draft-room membership" table/model was introduced; joining the live room is still fresh SocketTicket → Socket.IO connect → `draft:join`
  - **Start Draft** (commissioner-only, `POST /api/leagues/[leagueId]/draft`) and **Join Draft Room** (navigation) remain semantically distinct; Start Draft's server-side authorization/transaction behavior is unchanged from Milestone 3.1/4.1
  - `StartDraftForm` moved from the league-detail directory to `apps/web/app/leagues/[leagueId]/draft/start-draft-form.tsx`; a successful start now navigates directly into `/leagues/[leagueId]/draft/room` instead of back to the pre-draft page, since the commissioner who just started the draft should land directly in the live room
  - `/leagues/[leagueId]` (league detail) simplified: its Draft section is now a single stable "View Draft" link into `/leagues/[leagueId]/draft` for every role and every Draft state; the old three-branch (no-Draft-commissioner / no-Draft-member / Draft-exists) `StartDraftForm`-owning block was removed — all of that branching now lives exclusively on the pre-draft page
  - commissioner status on the pre-draft page is determined by `getLeagueDetail(...).league.ownerId === currentUserId` — the same authority source every other commissioner-only UI in this app already uses; never inferred from `draftSlot` or from `DraftStateResult`. This is presentation-only: `startDraft`'s own server-side owner authorization remains the actual authoritative check
  - `getLeagueDetail`'s `draft` field widened from `{ id: string } | null` to `{ id: string; status: DraftStatus } | null` — a purely web-only DTO change (this DTO is built directly from Prisma in `apps/web`, never crosses into `@fdm/shared` or the socket transport) — so the pre-draft page can distinguish ACTIVE/COMPLETE using its one existing query, with no second `getDraftState` call
  - added one shared, pure `deriveDraftBoard(state: DraftStateResult)` (`apps/web/app/leagues/[leagueId]/draft/draft-board-helpers.ts`) reused unmodified by both the pre-draft page and the live room — no second board-geometry implementation exists
  - board rows come from `state.league.rosterSize`, columns are the fixed `draftSlot` order (columns never reverse), and cell-slot mapping reuses the existing shared `getPickerForPickNumber` — no engine-level literal `15` and no duplicated snake/linear arithmetic were introduced anywhere in the board
  - completed board cells are populated only from authoritative `state.picks`; the current-pick cell highlights only while `status === "ACTIVE"`, derived from `currentPickNumber`; player metadata for a cell (`playerName`/`playerPosition`/`playerNflTeam`) comes directly from `DraftStatePick`, never from the separate 4.3 rostered-only `AvailablePlayer` pool
  - the pre-draft page's empty board is produced by feeding `deriveDraftBoard` a locally-constructed `DraftStateResult`-shaped value (built from the same `getLeagueDetail` fields already fetched, with `draft: null` and `picks: []`) — not a second query and not a second geometry implementation
  - added shared, pure `deriveTeamRosters(state: DraftStateResult)` (`apps/web/app/leagues/[leagueId]/draft/team-roster-helpers.ts`), grouping authoritative `state.picks` by member/user in `state.members`'s existing `draftSlot` order, each roster's picks remaining in their existing `pickNumber` order
  - added `TeamRosterPanel` (live room only): defaults to the authenticated user's own roster ("My Team") with a simple `<select>` to inspect any other manager's roster — one panel, not every team stacked vertically; no starter/bench concept, no roster-position enforcement
  - `AvailablePlayersPanel`'s `onDraft`, `canDraft`, and `pendingPlayerId` props are now optional; omitting `onDraft` puts the panel into read-only mode (search/filter/ADP Rank still work, no Action column rendered) for the pre-draft page, while the live room continues supplying all three for the unchanged 4.4 actionable behavior — no second player-list implementation was introduced
  - live-room layout: `TurnBanner` → full-width `DraftBoard` → a grid row of `AvailablePlayersPanel` (primary) + `TeamRosterPanel` (secondary), using the same existing inline-`style` conventions; no Tailwind or other styling framework was added
  - 15-round product rule: `rosterSize` remains the domain/database/engine representation of round count — Phase 3 completion (`totalPicks = teamCount * rosterSize`) and autopick logic, and the new board derivation, all continue reading `league.rosterSize`/`state.league.rosterSize` dynamically; no engine-level literal `15` was introduced anywhere
  - added `PRODUCT_ROSTER_SIZE = 15` in `apps/web/lib/leagues/schema.ts`; `createLeagueInputSchema` no longer has a `rosterSize` field at all (not merely a changed default) — a client that sends one is rejected by `.strict()` exactly like an `ownerId` spoofing attempt
  - `POST /api/leagues` always injects `rosterSize: PRODUCT_ROSTER_SIZE` before calling `createLeague()`, so every league created through the public API gets the current product's fixed 15-round draft length
  - `updateLeagueSettingsInputSchema` no longer has a `rosterSize` field either — there is no product/API path to change a League's round count after creation
  - `create-league-form.tsx` and `league-settings-form.tsx` no longer expose a roster-size input
  - the service-level `createLeague()` keeps its own `CreateLeagueInput` type (`CreateLeagueApiInput & { rosterSize: number }`), distinct from the public schema-inferred `CreateLeagueApiInput` — internal tests that need a non-15 `rosterSize` for engine/board fixtures keep calling `createLeague()` directly, unaffected; only the public HTTP boundary is fixed
  - no DB migration was required or performed; `rosterSize` was already a plain, unconstrained `Int` column, so historical League rows with non-15 values (e.g. `16`) continue to work unchanged, using their own stored `rosterSize` everywhere (engine, board, autopick)
- Milestone 4.5 verification:
  - `apps/web`: 29 test files / 281 tests passing (up from 261)
  - `packages/database`: 8 test files / 75 tests passing (unaffected)
  - `apps/socket-server`: 5 test files / 30 tests passing (unaffected)
  - workspace-wide typecheck passes
  - workspace-wide build passes with the required development environment variables loaded; both `/leagues/[leagueId]/draft` and `/leagues/[leagueId]/draft/room` registered as separate routes
  - new coverage: the 15-round public-contract boundary (public create/update schemas reject `rosterSize`; the create route always persists `15` regardless of request body), legacy non-15 `rosterSize` compatibility at both the pure board-derivation level and the settings-service level, pre-draft page routing/status branches (auth/member gating, no-Draft/ACTIVE/COMPLETE, commissioner full/not-full/non-commissioner), live-room redirect-before-start and render-after-start branches, `deriveDraftBoard` (LINEAR mapping, SNAKE round-boundary reversal with fixed columns, empty pre-draft board, populated live cells, current-pick highlighting restricted to `ACTIVE`, no highlight on `COMPLETE`, autopick-marker passthrough, and a historical non-15 `rosterSize` fixture), `deriveTeamRosters` (grouping, member ordering, pick ordering, empty rosters, multi-round accumulation, autopick passthrough), and the league-detail page's single stable View Draft link across commissioner/non-commissioner/Draft-exists states
  - Docker Postgres/Redis were confirmed running (`docker compose up -d`) before running the suite
  - manual verification (the one legitimate development OAuth identity, no fabricated users, `teamCount` minimum unrelaxed) confirmed: the league-detail View Draft link works; the pre-draft page loads with correct settings, draft order (with `(you)`/commissioner presentation), and an empty draft board showing correct snake geometry for the real league; read-only Available Players search/filter/ADP Rank work with no Draft action column present; the commissioner Start Draft control shows the correct disabled/waiting state for the underfilled real league; direct navigation to `/leagues/[leagueId]/draft/room` before the draft starts correctly redirects back to `/draft`; no unexpected runtime/console errors were observed beyond a pre-existing, unrelated missing-favicon 404
  - populated ACTIVE/COMPLETE multi-user live-board and live-roster behavior were not manually reproduced — the development database still has only one legitimate OAuth identity and no legitimate ACTIVE Draft — and remain covered by the automated pure-derivation tests above plus the existing Phase 3 real-Postgres/real-socket suites, consistent with every prior milestone's verification precedent
- Phase 4 Milestone 4.6 — Draft Room UX Hardening + Phase 4 Closeout:
  - added route-scoped `apps/web/app/leagues/[leagueId]/draft/draft-room.css`, imported once via a new pass-through `apps/web/app/leagues/[leagueId]/draft/layout.tsx` covering both `/draft` and `/draft/room`
  - CSS is used only where inline `style` props genuinely cannot express the need (a media-query breakpoint, a shared computed-once responsive grid, shared position-accent classes); the existing inline-style convention is otherwise unchanged everywhere else
  - live-room layout: Available Players (wide) + My Team (narrow) side by side on desktop via `.fdm-live-grid`, collapsing to one column under an 860px breakpoint
  - the Draft Board and Available Players tables scroll horizontally inside their own wrapper rather than compressing illegibly; the roster panel scrolls vertically past a bounded height
  - `DraftBoard` column headers are now built from every configured `1..teamCount` slot rather than from `state.members`, fixing a pre-existing header/column misalignment for an underfilled pre-draft league and giving every column a correct `scope="col"` header, including "Slot N — open" placeholders for unfilled slots
  - the authenticated user's board column gets a `(you)` text marker plus a subtle background highlight; the current-pick cell's styling always takes precedence over the user-column highlight even on the same cell, enforced with a combined CSS selector (`.fdm-current-pick.fdm-user-column`) rather than relying on declaration order
  - neither state relies on color alone: the user column also carries the `(you)` text, and the current-pick cell also carries visible "On the clock" text plus an `.sr-only` announcement
  - added `getRoundDirection(round, draftType)` and `getRoundForPick(pickNumber, teamCount)` to `draft-board-helpers.ts`; round rows use semantic `scope="row"` headers with a →/← direction glyph plus `.sr-only` text
  - completed board cells show a clearer player-name hierarchy, a pick-number label, a supplementary position-accent dot (`position-style.ts`'s `getPositionAccentClass`) alongside unchanged visible position/team text, and a small `AUTO` badge for autopicks; empty cells get a visually distinct dashed border
  - the pre-draft page reuses the same `DraftBoard` unmodified, now also passing `currentUserId` for the same column highlight/`(you)` treatment, plus new Snake/Linear explanatory copy above Draft Order
  - `TurnBanner` now derives and displays `Round X of Y · Pick Z overall` via new `getRoundInfo` (`draft-room-helpers.ts`); the countdown gets presentation-only warning/critical coloring via new `getCountdownUrgency`, with `formatCountdown`'s zero-clamping behavior unchanged
  - the turn-state live region (`role="status" aria-live="polite"`) is scoped narrowly to just the picker-name/turn text, not the ticking countdown, so a screen reader isn't re-announced every second
  - `AvailablePlayersPanel` gets real (visually hidden) `<label>`s for search/position filter, `scope="col"` headers, and a player-specific accessible name on each Draft button (`Draft {name}` / `Drafting {name}…`) instead of a flat list of identically-named buttons
  - new `shouldShowActionColumn(phase)` in `available-players-helpers.ts` drives hiding the Action column entirely once the Draft is `COMPLETE`, by reusing the panel's existing optional-`onDraft` read-only mode rather than rendering permanently-disabled Draft buttons
  - `TeamRosterPanel` gets a visible roster-selector label, round + overall pick context per line (via the same `getRoundForPick` the board uses), a matching position-accent dot and `AUTO` badge, and a bounded-height scroll container
  - accessibility pass: `scope="col"`/`scope="row"` table semantics, real form labels, player-specific button names, `role="alert"` on join/pick/resync error text, `role="status" aria-live="polite"` on the connection badge and turn-state text, native focus outlines preserved throughout, no custom keyboard widgets introduced, color never used as the sole carrier of state or position meaning
  - fixed the known 4.4 residual edge: on a successful `draft:pick` ack, the client now immediately emits `draft:join` to pull fresh authoritative state directly, rather than only passively waiting on the room-wide `draft:state` broadcast (which could fail/be lost after a successful commit while the socket stayed connected)
  - the resync reuses the existing `draft:join` event and `applyAuthoritativeState` function unchanged; `DraftPickAck` was not widened and no new socket event was added
  - the room-wide `draft:state` broadcast is unchanged and remains how every other connected client learns about the pick; if it also reaches the submitting client, reapplying it is safe — replacing `DraftStateResult` wholesale with each valid authoritative snapshot is always safe, whether or not it's newer than the resync's own snapshot
  - new pure `getPickAckAction(ack)` in `pick-submission-helpers.ts` is the tested decision behind this: a successful ack always resolves to `{type: "resync"}`; a rejected ack resolves to the existing `mapPickErrorToMessage` output
  - if the resync's own `draft:join` ack itself comes back rejected, that is not treated as "the pick failed" (the original ack already confirmed it succeeded) — pending/in-flight state is cleared and a distinct `resyncError` message is shown ("The draft room couldn't refresh after your pick. Refresh the page to load the latest state."), never the pick-rejection wording
  - `resyncError` clears on any fresh authoritative state application or on socket disconnect, exactly like the existing pending/in-flight clearing
  - deliberately no defensive timeout was added for the (accepted, low-risk) case where the resync's own ack is itself lost while the socket still appears connected — that residual case remains bounded by the room-wide broadcast or by Socket.IO's own heartbeat-driven `disconnect` (which already unconditionally clears pending state); this is not a mathematical exactly-once guarantee, only a substantial narrowing of the documented 4.4 failure mode
  - `COMPLETE` draft state: no current-pick highlight, final board and rosters remain fully visible, Available Players remains browseable with its Action column hidden (not disabled) — no post-draft management features were added
  - no Tailwind or other styling framework was introduced; no new frontend state-management library was introduced; no jsdom/React Testing Library was introduced
- Milestone 4.6 verification:
  - `apps/web`: 30 test files / 312 tests passing (up from 281)
  - `packages/database`: 8 test files / 75 tests passing (unaffected)
  - `apps/socket-server`: 5 test files / 30 tests passing (unaffected)
  - workspace-wide typecheck passes
  - workspace-wide build passes with the required development environment variables loaded; both `/leagues/[leagueId]/draft` and `/leagues/[leagueId]/draft/room` remain registered
  - new pure-helper test coverage: `getRoundDirection` and `getRoundForPick` (round-boundary/direction math), `getRoundInfo` (null pre-draft/COMPLETE, early pick, round boundary, final pick), `getCountdownUrgency` (normal/warning/critical thresholds including zero), `getPositionAccentClass` (all six positions plus a neutral fallback), `shouldShowActionColumn`, and `getPickAckAction` (successful ack → resync; every current `SocketErrorCode` → its existing mapped message)
  - `page.test.ts` extended to verify `currentUserId` is threaded into `DraftBoard`'s props on the pre-draft page
  - manual verification used the real dev database and the one legitimate development OAuth identity's own existing (non-expired) session, reused as an HTTP cookie against the running dev server rather than performing a fresh OAuth flow or fabricating any identity; confirmed against real server-rendered output: correct header/column count and `(you)`/`Slot N — open` placeholders for an underfilled real league, Snake explanatory copy, 16 alternating round-direction arrows for a 16-round league, real `AvailablePlayer` data with zero Action-column buttons in read-only pre-draft mode, and a real `307` redirect from `/draft/room` to `/draft` before a Draft exists
  - the actual compiled CSS chunk was fetched from the build output and confirmed to contain the `@media (max-width: 860px)` breakpoint and every new class exactly as written, including the `.fdm-current-pick.fdm-user-column` precedence rule
  - live interactive browser verification (visual screenshot, resizing to watch the grid collapse, clicking/tabbing) was not completed this milestone — the tool capable of injecting the dev session's httpOnly auth cookie into a real Playwright browser context was blocked by the environment's own permission classifier as RCE-equivalent, independent of the standing one-OAuth-account limitation
  - populated ACTIVE/COMPLETE multi-user live-room behavior (`TurnBanner`, `TeamRosterPanel`, pending-pick UX, the resync fix itself) remains unreachable for manual testing under the standing constraint — the live room now unconditionally requires a real Draft, which requires a fully-joined league that cannot be legitimately filled by one real account — and remains verified by the pure-helper tests above plus the existing Phase 3 real-Postgres/real-socket suites, consistent with every prior milestone's verification precedent
- Phase 5 Milestone 5.1 — Bot Membership / Participant Data Model:
  - introduced the unified human/bot draft-participant model: `LeagueMember` now represents either a real authenticated human or a server-owned bot, rather than always implying a human `User`
  - added `LeagueMemberType = HUMAN | BOT` (default `HUMAN`)
  - `LeagueMember.userId` is now nullable; `LeagueMember.displayName` is a new BOT-only field
  - HUMAN shape: non-null `userId`, null `displayName`, backed by a real `User` row
  - BOT shape: null `userId`, non-null `displayName`; no `User`/`Account`/`Session`/`SocketTicket` row ever exists for a bot — a bot is never a fake OAuth identity
  - a bot's durable participant identity is its own `LeagueMember.id`
  - the HUMAN/BOT shape invariant is enforced by a hand-written database `CHECK` constraint, not by TypeScript — Prisma 7.9.1 has no `@@check` schema DSL (confirmed via `prisma validate` against a scratch schema before writing the migration), so the constraint is invisible to `schema.prisma` and must be preserved by hand if this table is ever touched by a bare `prisma migrate dev`
  - `@@unique([leagueId, userId])` and `@@unique([leagueId, draftSlot])` are unchanged; PostgreSQL's standard (non-version-gated) NULL-distinct unique-index behavior means multiple BOT rows (`userId = null`) coexist under the same constraint that still rejects a duplicate human — verified with a real-Postgres integration test, not assumed from documentation
  - `draftSlot` uniqueness remains the positional authority for both HUMAN and BOT rows; no second slot-ownership table was introduced
  - identity split introduced by this milestone:
    - `User.id` — authentication identity: Auth.js/session identity, SocketTicket/socket authentication, commissioner/owner authorization, human membership lookup by `(leagueId, userId)`
    - `LeagueMember.id` — draft participant identity: draft-slot ownership, current-turn ownership, pick attribution, HUMAN or BOT alike
    - these were the same thing for every participant before this milestone; bots are the reason they are now two distinct identities
  - `Draft.currentUserId` removed; replaced by `Draft.currentMemberId`, an FK to `LeagueMember.id` with `onDelete: SetNull` — a live "who's on the clock" pointer, not historical attribution, so clearing it on a hypothetical LeagueMember deletion is harmless
  - `Pick.userId` removed; replaced by `Pick.leagueMemberId`, a required FK to `LeagueMember.id` with `onDelete: Restrict` — the historical-attribution FK: deleting a `LeagueMember` that has ever picked now fails loudly at the database level rather than silently erasing that participant's Pick history
  - `User.picks`/`User.currentTurnDrafts` back-relations removed; Pick/Draft no longer FK to `User` for these
  - `startDraft`'s fullness rule is unchanged (`LeagueMember count === teamCount`) — a BOT row counts toward that total exactly like a HUMAN row, with zero special-casing, because both are just `LeagueMember` rows; only the first-picker write changed, from `firstPicker.userId` to `firstPicker.id` (`Draft.currentMemberId`)
  - `submitPick`'s public signature and human-facing behavior are unchanged (`submitPick(leagueId, requestingUserId, playerId)`); internally it now resolves the requesting human's own `LeagueMember` by `(leagueId, userId)` (still userId-keyed — a human always authenticates with a real `User.id`), compares that membership's `.id` to `Draft.currentMemberId`, and writes `Pick.leagueMemberId` as that membership's `.id`. Bots never call this authenticated-human entry point
  - `applyPick`'s next-picker write got simpler, not just renamed: it now uses the next `LeagueMember`'s own `.id` directly, with no `.userId` hop
  - `processExpiredDraftTurn` (timer-expiry autopick) is a mechanical rename only (`currentUserId`→`currentMemberId` read, `leagueMemberId` write) with no behavior change for the human-only case that exists today
  - known, explicitly deferred gap: `processExpiredDraftTurn` does not inspect `currentMember.participantType` anywhere — if a BOT's `turnDeadline` ever elapsed, the sweep would autopick for it exactly like a human, with no guard. This is currently unreachable in production: the only two `LeagueMember`-creation call sites (`join-league.ts`, `create-league.ts`) never set `participantType`, relying solely on the schema default `HUMAN`, and no API route exposes it — the only place a `BOT` row can be created today is the test-only `createTestBotMember` helper. **Phase 5.3 must explicitly resolve bot-turn orchestration vs. timer-expiry autopick ordering before bot creation becomes product-accessible; this is not resolved by 5.1.**
  - member-facing DTOs (`DraftStateMember`, `LeagueDetailResult.members`, `ReorderLeagueMembersResult.members`) are normalized once, in `packages/database`/the DTO builder, to `{ membershipId, participantType, userId: string | null, name, image, draftSlot }` — `name`/`image` resolve as `HUMAN → user.name/user.image`, `BOT → displayName/null`, so UI components read one normalized `name`/`image` pair and never branch on `user.name ?? displayName` themselves
  - `TeamRosterPanel`'s roster selector and `deriveTeamRosters`'s grouping key are `membershipId`, not `userId` — a real bug the nullable-`userId` change would otherwise have introduced (every BOT would have collapsed onto the same `""` selector value once more than one bot exists in a league); `member-order-form.tsx` and `reorder-league-members.ts` needed the same nullable-`userId`/normalized-name treatment
  - no bot player selection, bot turn scheduler, automatic bot picks, mock-draft UI, fill-empty-slots UI, `PickSource`, strategy/difficulty/seed fields, position-aware bot drafting, temporary human-to-CPU takeover, fake OAuth identities, or socket/auth changes were introduced; `wasAutopick` is unchanged
- Milestone 5.1 verification:
  - `packages/database`: 89/89 tests passing (75 base + 14 new)
  - `apps/web`: 317/317 tests passing (312 base + 5 new)
  - `apps/socket-server`: 30/30 tests passing (unaffected — no handler/protocol source changes)
  - workspace-wide typecheck and build pass
  - new coverage: HUMAN/BOT shape acceptance, CHECK-constraint rejection of all four invalid shapes, multiple-BOT null-`userId` coexistence, `draftSlot` uniqueness regardless of participant type, a mixed HUMAN/BOT league filling to `teamCount` and starting successfully, a BOT explicitly occupying `draftSlot` 1 becoming `Draft.currentMemberId`, normalized HUMAN/BOT member DTOs (including mixed-membership ordering), a BOT-attributed `Pick` persisting/reading with no `User` row involved, and every existing human/manual/autopick SNAKE/LINEAR/concurrency test preserved unchanged in behavior
- Milestone 5.1 final verification pass:
  - the migration's historical backfill was additionally exercised against **populated** pre-5.1-shaped data, not only against the (actually-empty) dev database: a disposable PostgreSQL database was migrated through the immediately-preceding migration only, seeded with 2 Users, 1 League, 2 LeagueMembers, 1 ACTIVE Draft with an old `currentUserId`, and 2 Picks with an old `userId` (one manual, one `wasAutopick: true`), then the real Phase 5.1 migration was applied on top
  - verified directly in Postgres afterward: `Draft.currentMemberId` and both `Pick.leagueMemberId` values resolved to exactly the correct `LeagueMember` rows; `Draft`/`Pick` row counts were unchanged (1→1, 2→2); `pickNumber`/`playerId`/`wasAutopick` were unchanged; the old `currentUserId`/`userId` columns were fully gone; the migration's own internal backfill-verification blocks did not fire; `prisma migrate status` reported clean — the disposable database was dropped afterward
  - pre-migration dev-database counts were re-checked live rather than trusted from this document's own history: `Draft`: 0, `Pick`: 0, `League`: 7, `LeagueMember`: 7 — the populated-data replay above is what actually exercises the backfill SQL end-to-end
  - discovered and recorded, not fixed: deleting a League that already has Draft/Pick history fails. Verified directly against `fantasy_draft_test`: seeding a League/LeagueMember/Draft/Pick and then `DELETE FROM "League"` raises `ERROR: update or delete on table "LeagueMember" violates foreign key constraint "Pick_leagueMemberId_fkey"` — Postgres processes the `League → LeagueMember` cascade before the `League → Draft → Pick` cascade has removed the referencing Pick row, so the new `Restrict` on `Pick.leagueMemberId` trips first. The failure is transactional and clean (all rows verified still present afterward, then manually removed in FK-safe order) — not a data-corruption risk. No delete-League feature exists in the product today, so this is not a current blocker, but it **must** be resolved before any future League-deletion feature ships. See "Known issue — League deletion blocked by Pick → LeagueMember FK ordering" below
  - re-confirmed the bot/autopick deferred risk by direct inspection rather than re-asserting it: `packages/database/src/drafts/autopick.ts` never reads `participantType`; the only two production `LeagueMember.create` call sites never set it
  - repo-wide audit repeated for `currentUserId`, `currentUser`, `Pick.userId`/`pick.userId`, literal `"currentUserId"`, `leagueId_userId`, `$queryRaw`, `$executeRaw`: the Draft row-lock raw SQL correctly reads `"currentMemberId"`; every remaining `userId`-keyed lookup is intentional human-authentication logic (join, commissioner authorization, `submitPick`'s requester resolution), not a missed rename
  - `apps/web/next-env.d.ts` confirmed clean; `apps/web/tsconfig.tsbuildinfo`'s only diff was regenerated TypeScript build-cache output and was restored; the regenerated Prisma client under `packages/database/src/generated/prisma/` remains intentionally tracked, per this repository's existing convention
  - no source or test file was changed during this verification pass — it was disposable-database SQL work and read-only inspection only, so no regression suite was rerun
- Phase 5 Milestone 5.2 — Basic Best-Available Bot Strategy:
  - extracted the shared, deterministic BEST_AVAILABLE player-ranking primitive: `selectBestAvailablePlayerId(tx: Prisma.TransactionClient, { draftId, scoringFormat }): Promise<string | null>` in new `packages/database/src/drafts/player-selection.ts`, exported through `@fdm/database`'s public entry point
  - this is decision logic only — no bot turn detection, scheduler, execution path, socket change, or mock-draft UI was introduced; see "Scope" note in this milestone's own final bullet below
  - previously this ranking logic was a private, unexported function (`selectAutopickPlayerId`) living directly inside `autopick.ts`, reachable only by `processExpiredDraftTurn`; it is now a standalone, package-public function so a future Phase 5.3 bot orchestrator can call the identical primitive human timer-autopick already uses, without duplicating it
  - `processExpiredDraftTurn` was refactored to call the extracted `selectBestAvailablePlayerId` in place of its old private helper; its own lock → re-validate → select → `applyPick` → commit sequence is otherwise unchanged
  - the selector is read-only: it never writes a Pick, never touches `Draft`, and owns no part of the transactional correctness boundary itself — callers remain responsible for running it inside their own already-locked transaction (see "Turn-expiration and autopick conventions")
  - **intentional correction — unified automated-selection eligibility pool:** automated selection (both tiers) is now scoped to `Player.nflTeam IS NOT NULL` (rostered players only), matching the Phase 4.3 Available Players UI pool (`getAvailablePlayers`). Before this milestone, automated selection had no such restriction and could in principle select a teamless/provider-only player a human could never see or choose in the drafting UI — a pre-existing inconsistency between the UI pool and the autopick pool, now removed. There is exactly one rostered-eligibility definition, not two independently-maintained ones.
  - **intentional correction — deterministic ADP-tier tiebreak:** tier 1 (`PlayerAdp.adp ASC` for the league's scoring format) previously had no secondary sort at all, so an exact ADP tie between two undrafted candidates had no documented deterministic winner. It now sorts `adp ASC, player.searchRank ASC NULLS LAST, player.id ASC`, mirroring tier 2's existing tiebreak pattern.
  - fallback tier (only reached when no eligible rostered candidate has a non-null ADP for the requested format) is unchanged in shape: `searchRank ASC NULLS LAST, id ASC`
  - drafted-player exclusion remains scoped to the supplied `draftId` only — a Player drafted only in a different Draft remains eligible; draft pools stay per-Draft, not global
  - the selector never throws for "no eligible player" — it returns `null`; `processExpiredDraftTurn` remains the sole place that converts `null` into `AutopickExhaustedError` for the human-autopick case. No bot-specific exhaustion behavior was designed in 5.2; Phase 5.3 owns defining what a BOT turn does with a `null` result
  - no `BotDraftStrategy` enum, strategy-dispatch layer, or additional DTO was introduced — "BEST_AVAILABLE" is this one function's documented behavior, not a selectable/configurable value, until a second, genuinely different policy exists (5.5+)
  - documented (not yet enforced by code, since no caller exists yet) the required transaction shape for Phase 5.3: a future bot orchestrator must lock the Draft row, verify the current participant is a BOT, then call `selectBestAvailablePlayerId` and `applyPick` inside that same transaction — a player id selected outside a locked transaction must never later be fed into `applyPick` without re-selecting under the real lock
  - Scope: no bot turn detection, bot scheduler/orchestrator, automatic BOT picks, socket/broadcast changes, mock-draft UI, fill-empty-slots UI, strategy configuration, position-aware strategy, randomness/difficulty, temporary human-CPU takeover, `PickSource`, Phase 5.1 participant-model changes, or Auth.js/SocketTicket changes were introduced
- Milestone 5.2 verification:
  - `packages/database`: 103/103 tests passing (75 base + 28 new/changed) — new `player-selection.test.ts` covers rostered eligibility, teamless-player exclusion, same-draft vs. cross-draft drafted-player exclusion, lowest-ADP selection, scoring-format sensitivity, non-null-ADP-over-no-ADP, deterministic ADP-tier tiebreaks (searchRank, null-searchRank, id), fallback-tier ordering and tiebreaks (including all-null searchRank), no-eligible-player → `null`, and repeated-call determinism; `autopick.test.ts`'s "player selection" describe block was trimmed to wiring/regression coverage only (drafted-player exclusion and `AutopickExhaustedError` end-to-end through the extracted selector), avoiding duplicate ranking-permutation coverage across two files
  - `apps/web`: 317/317 tests passing (unaffected — no web source/test changes)
  - `apps/socket-server`: 30/30 tests passing (unaffected — no socket-server source/test changes)
  - workspace-wide typecheck passes
  - workspace-wide build passes with the required development environment variables loaded and Docker Postgres/Redis running
  - no schema change occurred and no Prisma client regeneration was required
  - `apps/web/tsconfig.tsbuildinfo` and `apps/web/next-env.d.ts` were regenerated by typecheck/build and restored via `git checkout --`, per the established repository convention from Milestone 5.1's verification pass
  - no bot turn detection, BOT participant lookup, scheduler, execution path, socket/broadcast change, mock-draft UI, or any Phase 5.1 schema/Auth.js/SocketTicket change was introduced
- Phase 5 Milestone 5.3 — Server-Side Bot Turn Orchestration:
  - BOT orchestration reuses the existing `apps/socket-server` turn sweep unchanged in lifecycle: one `startTurnSweep`, one `stopTurnSweep`, one self-rescheduling `setTimeout`, one configured interval — no second bot timer, no immediate/recursive bot-chaining
  - `runSweepOnce(io)` is now two sequential phases: `await runHumanExpirySweep(io); await runBotTurnSweep(io);` — the pre-5.3 human sweep body moved into `runHumanExpirySweep` unchanged, plus a new `runBotTurnSweep`. The sweep remains non-overlapping (the next tick is only scheduled after the current `runSweepOnce()` promise settles), exactly as before
  - `findExpiredActiveDraftLeagueIds` (human discovery) now additionally filters `currentMember: { participantType: "HUMAN" }` — a discovery-time efficiency filter only
  - `processExpiredDraftTurn` gained an authoritative post-lock guard: after locking the Draft row and confirming `currentMemberId !== null`, it re-reads that LeagueMember's `participantType` and, if not `HUMAN`, returns `{ outcome: "skipped", reason: "CURRENT_PARTICIPANT_IS_BOT" }` before ever checking `turnDeadline` — the discovery filter narrows candidates for efficiency, but this post-lock check is what's actually authoritative, since participant identity can change between the unlocked discovery read and the transaction acquiring the lock
  - added `packages/database/src/drafts/bot-turn.ts`: `findActiveBotTurnLeagueIds()` (discovers `Draft.status = ACTIVE AND currentMember.participantType = BOT`, deliberately with **no** `turnDeadline` condition — a BOT's turn is never gated on its deadline elapsing) and `processBotDraftTurn(leagueId): Promise<BotTurnOutcome>`
  - `processBotDraftTurn`'s sequence mirrors `processExpiredDraftTurn` exactly: lock Draft row → no Draft?/not ACTIVE? skip → re-read current LeagueMember → not BOT? skip (`NOT_BOT_TURN`) → read League config → `selectBestAvailablePlayerId` inside the same transaction → `null`? throw `BotPickExhaustedError` → `applyPick` with `leagueMemberId` = the BOT's own `LeagueMember.id` and `wasAutopick: false` → commit
  - `BotTurnOutcome` is a discriminated union (`{ outcome: "picked", ... } | { outcome: "skipped", reason: "NO_DRAFT" | "NOT_ACTIVE" | "NOT_BOT_TURN" }`), mirroring `AutopickOutcome`'s existing shape; expected stale/race conditions are skips, never exceptions
  - `lockDraftForLeague`/`applyPick` remain internal `@fdm/database` implementation details; `processBotDraftTurn`/`findActiveBotTurnLeagueIds` are exported publicly (like `selectBestAvailablePlayerId`, unlike the two mutation primitives) since `apps/socket-server` can only reach `@fdm/database` through its public entry point — no second Pick-writing path exists anywhere
  - added `BotPickExhaustedError` (new, distinct from `AutopickExhaustedError`) for BOT selector exhaustion — thrown inside the transaction, rolls back completely (no Pick, no `currentPickNumber`/`currentMemberId` change, Draft stays `ACTIVE` with the same BOT current), caught/logged by the socket-server sweep, which continues processing other leagues; no product-facing recovery UI exists
  - BOT picks persist `Pick.leagueMemberId` = the BOT's own `LeagueMember.id` and `wasAutopick: false` — a BOT's own intentional pick is not "a human missed their deadline," so `wasAutopick` keeps its pre-5.3 meaning exactly (`true` only for human timer-expiry autopick); a Pick's BOT-vs-human-vs-manual origin remains derivable by joining `Pick.leagueMemberId` against `LeagueMember.participantType`/`Pick.wasAutopick`, with zero new columns — no `PickSource` and no BOT-specific UI badge were introduced
  - deadline semantics: **no schema change.** `applyPick`'s existing "advance to next picker" branch is completely unmodified — it writes `turnDeadline = now + timerSeconds` identically regardless of whether the newly-current participant is HUMAN or BOT. Routing is entirely `participantType`-driven: for a HUMAN current participant, `turnDeadline` controls timer-expiry eligibility as before; for a BOT current participant, `participantType === BOT` alone controls BOT-sweep eligibility, and the BOT's stored deadline carries no wait requirement
  - verified transitions: HUMAN→BOT (the human phase's `applyPick` call writes a normal deadline; the BOT is picked up by `findActiveBotTurnLeagueIds`, and — since `runBotTurnSweep`'s discovery query runs only after `runHumanExpirySweep` fully completes and commits — may be processed in the **same** `runSweepOnce` tick as the human's autopick); BOT→BOT (exactly one BOT Pick per league per BOT-sweep phase — no recursion, no inner loop — so a consecutive BOT chain progresses one pick per subsequent sweep tick, not all at once); BOT→HUMAN (`applyPick` writes a fresh human deadline and ordinary timer-expiry behavior resumes unmodified)
  - broadcast split unchanged in spirit: `packages/database` never imports/emits Socket.IO; `apps/socket-server`'s new `runBotTurnSweep` calls the existing, unmodified `broadcastDraftState(io, leagueId)` only on a `"picked"` outcome — no broadcast on a skip, on `BotPickExhaustedError`, or on any stale/no-op pass. Bots never connect a socket and never mint/consume a SocketTicket
  - restart/zero-client behavior is a byproduct of the same mechanism the human sweep already had: `findActiveBotTurnLeagueIds()` is a live, unlocked Postgres read with no in-memory state, so a freshly-started process discovers and processes a pre-existing `ACTIVE`/BOT-current Draft on its very first tick, with zero clients and no in-memory-only trigger
  - concurrency: two concurrent `processBotDraftTurn` calls for the same BOT turn resolve exactly like two concurrent `processExpiredDraftTurn`/`submitPick` calls already do — whichever transaction locks the Draft row first applies the Pick; the second locks afterward, re-reads the now-advanced state, and returns a normal skip (`NOT_BOT_TURN`). PostgreSQL row locking remains the sole mutation-correctness boundary; no Redis or distributed lock was added, and none is required for this invariant regardless of whether duplicate calls originate from one process or (in a future multi-instance deployment) several — only operational scheduling, not this transaction guarantee, would change with future scaling infrastructure
  - confirmed (by direct test, not just by inspection) that a HUMAN can never submit a pick "as" a BOT while a BOT is current: a human's own membership always resolves via `(leagueId, userId)` to their own, non-BOT `LeagueMember` row, which structurally cannot equal `draft.currentMemberId` when a BOT is on the clock — `submitPick`'s existing, completely unmodified `NotOnTheClockError` check already rejects this correctly; no new BOT-authorization guard was added or needed
  - scope: no mock-draft creation UI, fill-empty-slots UI, bot strategy configuration, position-aware strategy, randomness/difficulty/personality, BOT-specific visual badge, temporary human-CPU takeover, `PickSource`, browser-side bot logic, fake OAuth/Auth.js identity, or Redis/queue infrastructure was introduced; **no production path creates a BOT `LeagueMember` yet** — bots remain reachable only through test-only fixtures (`createTestBotMember`), exactly as after 5.1/5.2
- Milestone 5.3 verification:
  - `packages/database`: 121/121 tests passing — new `bot-turn.test.ts` covers BOT pick success/attribution/`wasAutopick: false`, BEST_AVAILABLE selection, turn advancement, BOT→HUMAN and BOT→BOT progression, final-BOT-pick Draft completion, `NO_DRAFT`/`NOT_ACTIVE`/`NOT_BOT_TURN` skips, `BotPickExhaustedError` with full-rollback verification, concurrent-caller resolution, and `findActiveBotTurnLeagueIds` inclusion/exclusion cases; `autopick.test.ts` gained the authoritative HUMAN-guard test (expired BOT-current turn → `CURRENT_PARTICIPANT_IS_BOT`, zero Picks) and a discovery-filter exclusion test; a dedicated test proves `submitPick` already rejects a HUMAN submitting while a BOT is current, with no new guard
  - `apps/socket-server`: 37/37 tests passing — new `sweep.test.ts` coverage includes zero-client BOT processing, authoritative `draft:state` broadcast after a real BOT pick, no broadcast on BOT exhaustion, cold-start/first-tick BOT discovery (restart-recovery shape), a HUMAN-current draft left untouched by the BOT phase, a same-tick HUMAN-expiry→BOT-pick handoff (a 2-team LINEAR league: one `runSweepOnce()` call applies both the human's autopick and the newly-current BOT's pick, landing on `currentPickNumber = 3` back on the human), and a 3-BOT consecutive chain resolving one pick per tick across repeated `startTurnSweep` ticks
  - `apps/web`: 317/317 tests passing, unaffected — no `apps/web` source or test changes were needed
  - workspace-wide typecheck passes; workspace-wide build passes
  - no Prisma schema change occurred and no Prisma client regeneration was required
- Milestone 5.3 stale-dependency-build finding and final verification pass:
  - discovered (while rebuilding `@fdm/database` for the first time in this milestone) that both `apps/socket-server` and `apps/web` resolve `@fdm/database` through the pnpm workspace symlink, whose `package.json` `"exports"` field points at `./dist/index.js` — **neither consuming app ever imports `packages/database/src` directly**, so a consuming package's tests can silently execute stale `@fdm/database` output if `packages/database` was not rebuilt after a source change
  - concretely: Milestone 5.2's own verification pass ran `apps/socket-server`'s test suite *before* that session's final `pnpm -r build`, so those tests exercised the pre-5.2, unrestricted-eligibility `dist` and never actually observed the new `Player.nflTeam IS NOT NULL` rostered-only rule; five `apps/socket-server/src/timers/sweep.test.ts` fixtures were feeding the automated-selection path a teamless (`nflTeam: null`) `createTestPlayer()` and had never been updated to match 5.2's own rostered-eligibility correction
  - fixed: the five affected fixtures now create rostered (`nflTeam: "KC"`) players, matching the same pattern already used by `packages/database`'s own 5.2 test fixtures
  - audited every other repository test file that creates Player fixtures (`concurrency.test.ts`, `draft-pick.test.ts`, and `apps/web`'s pick-route/draft-page/`submit-pick` tests) and confirmed none of them exercise `processExpiredDraftTurn`/`processBotDraftTurn`/`selectBestAvailablePlayerId` — they all use manual `submitPick`, which is pool-agnostic by design — so no further stale-fixture cases exist
  - final verification procedure, run in this exact order: (1) removed the gitignored `packages/database/dist` and `packages/shared/dist` entirely; (2) rebuilt the workspace via the repo's own `pnpm -r run build` (which builds `packages/shared` → `packages/database` before `apps/socket-server`/`apps/web`, confirmed by build-log ordering); (3) only then ran `packages/database`, `apps/socket-server`, and `apps/web` tests; (4) ran workspace typecheck; (5) ran workspace build once more as final confirmation
  - `apps/web` is structurally exposed to the identical stale-`dist` risk as `apps/socket-server` (same symlink/`exports` resolution, no test-time source alias in `apps/web/vitest.config.mts`) — it simply hasn't manifested yet because no current `apps/web` test exercises the automated-selection eligibility path; this is a general, pre-existing workspace-tooling characteristic, not a defect introduced by or unique to Phase 5.3
  - `apps/web/tsconfig.tsbuildinfo` and `apps/web/next-env.d.ts` were regenerated by typecheck/build and restored via `git checkout --`, per the established convention; no unexpected Prisma-generated diff appeared
- Phase 5 Milestone 5.4 — Mock Draft Creation / Fill Empty Slots with Bots:
  - added the first production code path that can ever create a BOT `LeagueMember` — before this milestone, bots existed only through the test-only `createTestBotMember` fixture
  - added `fillOpenLeagueSlotsWithBots(leagueId, requestingUserId)` (`apps/web/lib/leagues/fill-bots.ts`): commissioner-only, pre-Draft only, locks the League row via the existing `authorizeLeagueOwner`, rejects with the existing `DraftAlreadyStartedError` if a Draft already exists, computes every open `draftSlot` in `1..teamCount` from a fresh read taken under that lock, and creates one BOT `LeagueMember` per open slot in a single `createMany` inside that same transaction
  - added `removeBotLeagueMembers(leagueId, requestingUserId)` (`apps/web/lib/leagues/remove-bots.ts`): the same commissioner-authorization + League-row-lock + draft-existence-guard shape, `deleteMany({ participantType: "BOT" })` scoped to the league — HUMAN rows are never touched by this query, and this is safe pre-Draft specifically because a bot with no Draft yet has no `Pick` row to trip `Pick.leagueMemberId`'s `Restrict`
  - both services reuse `authorizeLeagueOwner` and `getDraftForLeague` verbatim — no second lock primitive, no new draft-existence check, following the exact `join-league.ts`/`reorder-league-members.ts`/`update-league-settings.ts` shape
  - Fill is idempotent: zero open slots is a normal success (`botsCreated: 0`), not a conflict. Remove is idempotent: zero BOT rows is a normal success (`botsRemoved: 0`)
  - BOT `displayName`s are stable ordinals (`"CPU 1"`, `"CPU 2"`, …) assigned in ascending open-slot order *during that Fill call*, continuing from however many BOT rows already exist in the league (so a later Fill — e.g. after Remove reopened slots, or after `teamCount` was raised — never reuses an ordinal already in use) — deliberately **not** named after the `draftSlot` they fill, since a pre-Draft reorder can move a bot to a different slot afterward and a slot-based name would then be actively wrong; `draftSlot`, never `displayName`, is the authoritative draft position
  - concurrency: `fillOpenLeagueSlotsWithBots` locks the identical League row `joinLeague` already locks via its own `SELECT ... FOR UPDATE` — no coordinated code change was needed for this to be true, it falls directly out of both services locking the same row. Two concurrent Fill calls for the same league: whichever commits first fills the slots open at that moment; the second re-reads fresh membership under its own lock acquisition and fills only what's still open (normally zero) — never a duplicate `draftSlot`, never more than `teamCount` total members. A concurrent HUMAN join vs. Fill resolves to exactly one of two valid outcomes depending on lock order: join-first leaves Fill one fewer slot to fill; Fill-first leaves the join to see a full league and receive the existing `LeagueFullError` — no human is ever displaced, no bot is ever silently evicted — proven by a dedicated real-Postgres concurrency test, not just reasoned about
  - added `POST /api/leagues/[leagueId]/bots/fill` and `DELETE /api/leagues/[leagueId]/bots` (`apps/web/app/api/leagues/[leagueId]/bots/{fill/route.ts,route.ts}`); neither route reads a request body — there is no legitimate client-controlled BOT field (`participantType`, `displayName`, `draftSlot`, or bot count are all server-derived), so there is nothing to validate against a schema
  - status mappings reuse existing error classes/conventions exactly: `401` unauthenticated, `404` `LeagueNotAccessibleError`, `403` `NotLeagueOwnerError`, `409` `DraftAlreadyStartedError`; both a successful Fill/Remove and an idempotent no-op Fill/Remove return `200` (Fill does **not** use `201`, since it can legitimately create zero rows). No `BotFillConflictError` or new P2002 target-inspection path was added — the League-row lock is the product-level concurrency guarantee, and the pre-existing P2002 constraint-metadata maintenance issue remains untouched/deferred
  - added commissioner-only pre-draft-page UI: `FillBotsForm`/`RemoveBotsForm` (`apps/web/app/leagues/[leagueId]/draft/{fill-bots-form.tsx,remove-bots-form.tsx}`), following `StartDraftForm`'s exact idle/pending/error shape; both call `router.refresh()` on success rather than constructing any optimistic BOT membership row client-side; Remove Bots is gated behind a plain `window.confirm(...)` explaining that BOT managers will be removed and their slots reopened — no modal system was introduced
  - the pre-draft page's commissioner branch now also shows a `"{n}/{teamCount} managers joined — {k} CPU managers"` line once any bot exists, and a `(BOT)` text marker (never color alone) in the draft-order list; the same marker was added to `DraftBoard`'s column header and `TeamRosterPanel`'s roster selector — all three derive it purely from `participantType === "BOT"`. This is never confused with the existing `AUTO` pick badge: `AUTO` remains tied exclusively to `Pick.wasAutopick === true`, and a BOT's own intentional pick persists `wasAutopick: false` (unchanged from Phase 5.3), so BOT picks render with no `AUTO` badge and no BOT-specific pick-level badge either. No `PickSource` was introduced
  - added a commissioner-only, pre-Draft-only **"Manage draft order"** link on the pre-draft page, pointing to `/leagues/[leagueId]` — the existing league-detail page where the existing, completely unmodified `MemberOrderForm` lives. This closes a discoverability gap found during this milestone's own verification: the backend/service layer already fully supported a commissioner filling bots, reordering the resulting mixed HUMAN/BOT membership, and moving themselves off slot 1 before starting — but the pre-draft page had no link to the page that UI lives on. No second reorder component was created, no reorder logic was duplicated, and `reorderLeagueMembers`/`startDraft` were not touched
  - **verified directly (not merely inferred) that `reorderLeagueMembers` already works correctly on a mixed HUMAN/BOT membership list with zero code changes**: it operates purely on submitted `LeagueMember.id`s and final array order, never inspecting `participantType`/`userId`/`displayName` — a BOT's membership id is just another id to this service. A commissioner may Fill Bots, reorder themselves away from slot 1, then Start Draft; `draftSlot` after the reorder — not the owner's identity or original slot — determines who is on the clock first, for both LINEAR and SNAKE draft types (SNAKE's round-boundary reversal continues to be governed entirely by the unmodified `getPickerForPickNumber`)
  - `startDraft` required zero changes: once `members.length === teamCount` for a mixed HUMAN/BOT league (in any post-reorder slot arrangement), it starts exactly as it always has — no mock-specific draft-start path exists, and the first picker is simply whichever `LeagueMember` occupies slot 1 at that moment
  - the live room required zero architecture changes: `getCurrentPickerName`/`isYourTurn` (`draft-room-helpers.ts`) already matched on `membershipId`/`currentMemberId`, `TeamRosterPanel`'s selector was already keyed by `membershipId`, and a BOT's `userId: null` already could never receive the `(you)` marker or enable pick submission (`canSubmitPick` is gated by `isYourTurn`) — all confirmed by direct re-inspection of the actual code during this milestone, not assumed from Phase 5.1's design notes. The only change made anywhere in the live-room stack was the presentation-only `(BOT)` marker above, plus threading `participantType` through `TeamRoster` (`team-roster-helpers.ts`) so `TeamRosterPanel` could render it
  - BOT pacing (2000ms default sweep interval, at most one BOT pick per league per BOT-sweep phase, no recursive chaining) is completely unchanged from Phase 5.3 — this milestone is what first makes that pacing product-observable (a real multi-bot mock draft can now actually be run), and it was observed working correctly across consecutive BOT turns and a SNAKE round boundary, but no pacing change was made or is being proposed here
  - player-pool capacity was checked against real dev data rather than assumed: ~1,068 rostered players vs. 180 needed for a 12×15 draft (300 for 20×15) — comfortably sufficient for realistic mock-draft sizes; automated-selection eligibility was not broadened
  - scope: no separate `/mock-drafts` product area, no bot strategy/difficulty/personality/randomness, no position-aware drafting, no temporary HUMAN-to-CPU takeover, no automatic BOT replacement on a HUMAN join, no bot queue/watchlist, no sweep-pacing change, no League-delete FK fix, no P2002 maintenance, and no broad styling redesign were introduced
- Milestone 5.4 verification:
  - `apps/web`: 358/358 tests passing (up from 317) — new coverage: Fill (open-slot count, exact `draftSlot` assignments, deterministic ordinal names including ordinal-continuation after a partial refill, BOT shape invariant, HUMAN rows untouched, already-full no-op, authorization, Draft-exists rejection, concurrent Fill, HUMAN-join-vs-Fill race), Remove (BOT-only removal, HUMAN preserved, no-op semantics, pre-Draft restriction, slot reopening, subsequent join/Fill reuse), both API routes' status mappings and response DTOs, pre-draft-page rendering (Fill/Remove/Manage-draft-order visibility for commissioner vs. non-commissioner, underfilled vs. full, ACTIVE/COMPLETE branches unaffected), the `(BOT)` marker in the draft-order list, `TeamRoster.participantType` threading, and an integration test proving Fill → Start Draft → the existing `processBotDraftTurn` all compose correctly with no special fixture construction — plus a dedicated LINEAR and a dedicated SNAKE test proving Fill → reorder (HUMAN moved off slot 1) → Start Draft → BOT turns → HUMAN-on-the-clock-at-the-chosen-slot, including the SNAKE round-1/round-2 boundary
  - `packages/database`: 121/121 tests passing, unaffected — no `packages/database` source or test changes were needed for this milestone
  - `apps/socket-server`: 37/37 tests passing, unaffected — no `apps/socket-server` source or test changes were needed for this milestone
  - workspace-wide typecheck passes; workspace-wide build passes with both new bot routes registered
  - no Prisma schema change occurred and no Prisma client regeneration was required
  - `apps/web/tsconfig.tsbuildinfo` and `apps/web/next-env.d.ts` were regenerated by typecheck/build and restored via `git checkout --`, per the established convention; `next-env.d.ts` was additionally observed to flip its reference between `.next/dev/types/routes.d.ts` and `.next/types/routes.d.ts` depending on whether `next dev` or `next build`/`next typegen` ran most recently — pure generated-file churn (a `next typegen` run was needed each time to populate the new bot routes' `RouteContext` types before typecheck would pass), not a source issue, and restored to the committed state afterward every time
  - manual verification: full browser automation remained blocked by the same OAuth-session/Playwright environment limitation documented at Milestone 4.6. The equivalent real production service functions (`createLeague`, `fillOpenLeagueSlotsWithBots`, `removeBotLeagueMembers`, `reorderLeagueMembers`, `startDraft`, `submitPick`, `processBotDraftTurn`, `getDraftStateForLeague`) were exercised directly against the real dev database (`fantasy_draft`) using the one real OAuth user's actual id — no fake identity. Confirmed: Fill Bots creates the correct ordinal-named bots; Remove Bots removes only bots and reopens their slots; a second Fill after Remove restarts ordinal naming correctly; Start Draft succeeds on the resulting mixed league; the human's own manual pick and 6 consecutive automatically-processed BOT picks (via direct `processBotDraftTurn` calls simulating sweep ticks) persisted correctly with real ADP-driven BEST_AVAILABLE selections and correct snake round-boundary wraparound; and, in a second run, reordering the human from slot 1 to slot 4 before starting resulted in the slot-1 BOT being on the clock first and the human correctly coming on the clock at pick 4. This is service-level verification against real data, not full browser E2E — reported explicitly as such, not claimed otherwise. The leagues created during this verification were left in the dev database (consistent with how prior milestones' manual verification left real created leagues behind); the scratch verification scripts themselves were deleted afterward and never committed

### Current phase

**Phase 5 — Bot Managers + Mock Drafts — IN PROGRESS**

Completed:

- Phase 1 — Foundation — COMPLETE
- Phase 2 — League Management — COMPLETE
- Phase 3 — Realtime Draft Engine — COMPLETE (Milestones 3.1, 3.2, 3.3a, 3.3b, 3.4; see "Milestone 3.5 status" below for why there is no separate 3.5)
- Phase 4 — Client Experience — COMPLETE (Milestones 4.1–4.6)
- Phase 5 Milestone 5.1 — Bot Membership / Participant Data Model — COMPLETE
- Phase 5 Milestone 5.2 — Basic Best-Available Bot Strategy — COMPLETE
- Phase 5 Milestone 5.3 — Server-Side Bot Turn Orchestration — COMPLETE
- Phase 5 Milestone 5.4 — Mock Draft Creation / Fill Empty Slots with Bots — COMPLETE

Current Phase 5 status:
- 5.1 — Bot Membership / Participant Data Model — **COMPLETE**
- 5.2 — Basic Best-Available Bot Strategy — **COMPLETE**
- 5.3 — Server-Side Bot Turn Orchestration — **COMPLETE**
- 5.4 — Mock Draft Creation / Fill Empty Slots with Bots — **COMPLETE**
- 5.5 — Position-Aware Bot Strategy — **NEXT**
- 5.6 — Bot Strategy Variants + Phase 5 Closeout — not started

**Phase 5 is not complete.** The data-model foundation (5.1), BEST_AVAILABLE decision logic (5.2), server-side BOT turn orchestration (5.3), and product-accessible mock-draft creation (5.4) have all shipped. A commissioner can now legitimately create BOT `LeagueMember`s through the product (`Fill Open Slots with Bots` on `/leagues/[leagueId]/draft`), optionally remove them, optionally use the existing reorder UI to choose their own draft position before starting, start the resulting mixed HUMAN/BOT league through the unchanged `startDraft`, and watch BOT turns get picked for automatically, server-side, through the same authoritative transactional/broadcast path every other pick source uses. **One real human can now run a full solo mock draft against bots with no fake accounts.** What remains for Phase 5 is bot *strategy*, not bot *accessibility*: position-aware drafting (5.5) and strategy variants (5.6). See Milestones 5.1/5.2/5.3/5.4's own completed-work notes above for the exact boundary of what shipped at each step.

Milestone 3.5 status: the roadmap originally scoped a standalone "Reconnect/Resync" milestone after 3.4. Its core mechanism — mint a fresh SocketTicket, reconnect, rejoin via `draft:join`, and resync from authoritative Postgres state — was already implemented and manually verified in **3.3b**, before 3.4 existed. That resync path re-reads whatever the current authoritative Draft state is, so it needed no additional code to also reflect autopick-driven state changes made by the 3.4 sweep while a client was disconnected. What genuinely was never built and remains open is presence (`user:joined`/`user:left`, socket-disconnect-driven room cleanup — already listed under "Not yet implemented" and explicitly Phase 4 scope) and event replay/incremental recovery (also already listed). There is no distinct, un-started body of "3.5" work to schedule separately from those already-tracked items.

Current Phase 3 capabilities:
- a completely filled League can be started by its commissioner
- draft start creates the League's single Draft directly as `ACTIVE`
- initial picker and turn deadline are server-derived
- draft order is defined by tested persistence-independent shared logic, used by draft start, manual picks, socket picks, and autopick alike
- simultaneous start attempts cannot create duplicate Drafts
- league settings and draft-slot order become immutable once a Draft exists
- authenticated LeagueMembers can submit manual picks through the HTTP pick endpoint or realtime `draft:pick`
- pick submission is server-authoritative and transactionally serialized on the Draft row
- exactly one concurrent submission — manual or automatic — can consume a turn
- successful picks atomically persist the Pick and advance Draft state
- the final pick, manual or automatic, atomically transitions the Draft to `COMPLETE`
- shared Prisma-dependent draft services live in `@fdm/database`
- authoritative draft-state DTO types live in persistence-independent `@fdm/shared`
- authenticated web sessions can mint short-lived, single-use SocketTickets
- the standalone Socket.IO server authenticates connections by atomically consuming SocketTickets
- socket identity is derived exclusively from the consumed ticket
- authenticated LeagueMembers can join league-scoped realtime rooms
- room joins return authoritative Postgres-backed draft state
- realtime picks use the same shared transactional `submitPick` service as HTTP picks
- accepted socket picks broadcast a full authoritative `draft:state` snapshot; rejected socket picks return acknowledgement error codes and do not broadcast
- multiple sockets/tabs for the same authenticated user are supported
- reconnecting clients mint a fresh SocketTicket, reconnect, rejoin, and resync authoritative state
- `apps/socket-server` runs a single recurring, self-rescheduling turn-expiration sweep (default 2000ms) instead of one timer per Draft
- expired ACTIVE Drafts are discovered from live Postgres state, so a restarted socket-server process rediscovers exactly the same expired/future deadlines with no in-memory timer reconstruction
- expired turns are autopicked deterministically (ADP → searchRank → id) and persisted with `Pick.wasAutopick = true`
- manual picks and autopicks serialize on the same Draft-row lock and share the same internal pick-application/progression logic
- successful autopicks broadcast one authoritative `draft:state` snapshot to the League room; stale/no-op sweep passes do not broadcast
- authenticated users can browse every League they belong to (owned or joined) at `/leagues`, with links into each League's detail page

Current Phase 4 capabilities:
- commissioners can start a completely filled League's draft directly from `/leagues/[leagueId]`, without needing curl/Postman
- `/leagues/[leagueId]` reflects Draft existence: no Draft yet routes into a role-appropriate start/status view (disabled progress state or enabled action for the commissioner, status text for everyone else); an existing Draft routes into the draft-room link instead
- the draft room at `/leagues/[leagueId]/draft` presents human-readable no-Draft / ACTIVE / COMPLETE state, current-picker identity, "your turn" emphasis, and a cosmetic countdown derived from authoritative `turnDeadline`, instead of raw debug fields
- the draft room's realtime connection state (connecting/live/reconnecting/error) is presented accurately, distinguishing Socket.IO failures that will retry automatically from ones that will not (via `socket.active`), while always preserving the last authoritative snapshot through a temporary disconnect
- the draft room at `/leagues/[leagueId]/draft` includes an Available Players panel: a server-fetched, rostered-only (`nflTeam IS NOT NULL`) player pool filtered client-side by case-insensitive partial name search and an `All | QB | RB | WR | TE | K | DEF` position filter, with drafted players excluded via IDs derived from authoritative `state.picks`
- each Available Players row now has a Draft action wired to the existing Socket.IO `draft:pick` protocol; buttons are gated on draft phase, authoritative turn ownership, connection status, and pending-request state as a UX convenience only, with `submitPick`/PostgreSQL remaining fully authoritative and the temporary raw player-ID debug form removed
- the Available Players table displays a stable integer ADP Rank — each player's position in the full ADP-sorted pool — instead of the raw decimal ADP, unaffected by search/position filtering
- pre-draft and live drafting are now two distinct routes: `/leagues/[leagueId]/draft` is a stable, non-realtime pre-draft/draft-summary page (settings, draft order, empty draft board, read-only Available Players, commissioner Start Draft control before a Draft exists; a compact summary + Join/View Draft Room link once one exists), and `/leagues/[leagueId]/draft/room` is the live draft room, the only place Socket.IO ever connects, redirecting back to `/draft` if visited before a Draft exists
- the draft room now includes a full Draft Board (rows = `rosterSize` rounds, fixed `draftSlot` columns, snake/linear cell mapping via the shared `getPickerForPickNumber`, completed cells from authoritative `state.picks`, current-pick highlighting while `ACTIVE`) and a My Team / roster-inspection panel (defaults to the authenticated user's own roster, with a selector for any other manager), both built from one shared pair of pure derivations (`deriveDraftBoard`, `deriveTeamRosters`) reused unmodified by the pre-draft page's empty board
- newly created leagues are fixed to a 15-round draft (`PRODUCT_ROSTER_SIZE`); the public create/update contracts no longer accept a `rosterSize` field at all, while `rosterSize` itself remains a fully dynamic engine/database value — historical non-15 leagues, and internal test fixtures that call `createLeague()` directly, are unaffected
- the live room and pre-draft page share one small route-scoped stylesheet for responsive layout, position accents, and screen-reader-only text; the live room's Available Players/My Team panels collapse from side-by-side to stacked under an 860px breakpoint, and both the Draft Board and Available Players tables scroll internally rather than compressing
- the Draft Board highlights the authenticated user's column and the current-pick cell, with the current-pick treatment always taking visual precedence over the user-column highlight on the same cell, and neither state relying on color alone
- a successful `draft:pick` ack now triggers an immediate `draft:join` resync rather than only waiting on the room-wide broadcast, substantially narrowing the previously-documented ack-success/broadcast-loss stuck-pending edge with no protocol change
- a `COMPLETE` Draft hides the Available Players Action column entirely (reusing the panel's existing read-only mode) instead of showing disabled Draft buttons

Current Phase 5 capabilities (Milestones 5.1–5.4):
- `LeagueMember` rows may be `HUMAN` (a real `User`) or `BOT` (no `User`/OAuth identity at all), enforced by a database `CHECK` constraint
- a bot's participant identity is its own `LeagueMember.id`; there is no fake Auth.js identity anywhere for a bot
- multiple bots may coexist in one league (`userId = null` rows don't collide under `@@unique([leagueId, userId])`)
- `Draft.currentMemberId` and `Pick.leagueMemberId` identify the current picker / a pick's author by participant identity, not user identity, so a HUMAN or a BOT can equally be on the clock or own a pick
- `startDraft` and `submitPick`'s human-facing behavior are otherwise unchanged; a BOT LeagueMember row fills a draft slot exactly like a HUMAN one for fullness purposes
- member-facing DTOs expose a normalized `participantType`/`userId`/`name`/`image` shape so existing UI (Draft Board, Team Roster, member ordering) can render a mixed HUMAN/BOT league without per-component branching
- a deterministic BEST_AVAILABLE player-selection primitive (`selectBestAvailablePlayerId`) exists in `@fdm/database`, shared by human timer-autopick and (as of 5.3) real server-side BOT turn processing
- automated selection (both human timer-autopick and BOT selection) is rostered-player-only, matching the human Available Players UI pool — see Milestone 5.2's notes for the eligibility-unification rationale
- `apps/socket-server`'s single recurring turn sweep now has two phases each tick: HUMAN timer-expiry (unchanged) and BOT-turn processing (new) — a BOT `LeagueMember` currently on the clock is discovered by `participantType` alone (never by `turnDeadline`) and picked for automatically, through the same locked-transaction/`applyPick`/`draft:state`-broadcast path every other pick source uses, with zero client/browser/socket involvement required
- a BOT's turn is not gated on any deadline elapsing; it is processed on the next sweep tick after becoming current (typically ≤ the sweep interval, default 2000ms), and a BOT chain drains at one pick per league per tick — no recursive/instant chaining
- this orchestration is restart-safe and zero-client by the same mechanism the pre-existing human sweep already had (live Postgres discovery, no in-memory timer state); it is also duplicate-call-safe under concurrent invocation via the same Draft-row lock every other pick path already uses, with no Redis/distributed lock involved
- **as of Milestone 5.4, a commissioner can product-legitimately create BOT `LeagueMember`s** — `fillOpenLeagueSlotsWithBots` (`apps/web/lib/leagues/fill-bots.ts`) fills every open draft slot with a BOT, commissioner-only and pre-Draft only, in one atomic transaction reusing the existing League-row lock; `removeBotLeagueMembers` (`apps/web/lib/leagues/remove-bots.ts`) removes only BOT rows, leaving HUMAN memberships untouched, and reopens their slots. Both are exposed through `POST /api/leagues/[leagueId]/bots/fill` / `DELETE /api/leagues/[leagueId]/bots` and commissioner-only pre-draft-page controls. `createTestBotMember` is no longer the only way a BOT `LeagueMember` can exist
- BOT display names are stable ordinals (`CPU 1`, `CPU 2`, …), assigned in ascending open-slot order and never derived from `draftSlot` — `displayName` is presentation only; `draftSlot` remains the sole authoritative draft position, verified to survive a pre-Draft reorder correctly (see below)
- **verified in Milestone 5.4 that the existing `reorderLeagueMembers` service, unmodified, already supports a mixed HUMAN/BOT membership list** — a commissioner may Fill Bots, then use the existing reorder UI (now linked directly from the pre-draft page via a **"Manage draft order"** link) to move themselves away from slot 1, then Start Draft; the resulting `draftSlot` assignment, not the commissioner's identity or original slot, determines who is on the clock first, for both LINEAR and SNAKE draft types
- see Milestone 5.1's, 5.2's, 5.3's, and 5.4's own notes for the full boundary of what shipped, and "Known issue — League deletion blocked by Pick → LeagueMember FK ordering" below for a verified, still-open limitation Milestone 5.1 surfaced

**Phase 4 exit criteria satisfied.** All six milestones (4.1–4.6) are complete, and Phase 4 is frozen as a completed foundation the same way Phases 2 and 3 were, unless a later phase exposes a concrete defect. Phase 3's originally-scoped milestones (3.1–3.4, plus the reconnect/resync capability originally scoped as 3.5 — see note above) remain complete and frozen as well. Horizontal scalability (Redis pub/sub across multiple socket-server instances), rate limiting, structured error responses, Playwright E2E coverage, and CI remain explicitly deferred to Phase 5's own closeout (5.6) and beyond; Phase 5 itself is underway (Milestones 5.1–5.4 complete, 5.5 next).

### Not yet implemented

- Redis-backed cross-process/multi-instance realtime publication
- immediate Socket.IO publication of successful HTTP-originated mutations
- event replay or more sophisticated reconnect recovery beyond the basic mint-ticket/rejoin/resync mechanism delivered in 3.3b
- presence (`user:joined`/`user:left`, socket-disconnect-driven room cleanup)
- chat
- sticky live-room panels and board/list transition animations — evaluated during Milestone 4.6 and intentionally left out; what did ship in 4.6 was static readability/accessibility polish plus position-accent coloring (see Milestone 4.6's completed-work notes), not these two items
- the residual (low-probability) case where a pick's success ack, the resulting `draft:join` resync's own ack, *and* the room-wide `draft:state` broadcast are all lost while the socket still appears connected — bounded by Socket.IO's heartbeat-driven `disconnect` (which already unconditionally clears pending state), not defended with an additional client-side timeout; see Milestone 4.6's completed-work notes and "Realtime reconnect behavior" below
- pause/resume
- draft/pick undo
- roster-position enforcement, including roster-aware autopick selection, if later required
- ML recommendation system
- GitHub Actions CI
- `Pick` "source" concept (`PickSource`) distinguishing MANUAL/AUTOPICK/BOT — deferred; see "Settled decisions" (already derivable today from `Pick.leagueMemberId` joined against `LeagueMember.participantType`/`Pick.wasAutopick`, with zero new columns)
- a BOT-specific visual indicator/badge on individual picks in the draft-room UI (a BOT pick currently renders with no `AUTO` badge, since `wasAutopick: false`, and no BOT-specific pick-level badge exists either — Milestone 5.4 added a member-level `(BOT)` text marker in the draft order/board header/roster selector, which is a different thing from a pick-level badge)
- bot strategy/difficulty/seed configuration fields
- position-aware bot drafting
- temporary human-to-CPU turn delegation (distinct from bot-owned mock-draft slots — see "Future roadmap notes")
- tighter BOT-pick pacing than "one pick per league per sweep tick" — a long all-BOT chain currently drains at up to one pick per sweep interval (default 2000ms) per league; this is an intentional correctness-first starting point (see Milestone 5.3's notes) and was carried unchanged through Milestone 5.4, which made this pacing product-observable for the first time (a real solo mock draft with many bot slots) rather than only a theoretical concern — observed acceptable during 5.4's manual verification, but may be revisited later if real mock-draft UX demands faster pacing; any such change must remain row-lock-based, not introduce a new correctness mechanism
- fixing League deletion's FK-ordering failure against Draft/Pick history — see "Known issue — League deletion blocked by Pick → LeagueMember FK ordering"; not a current blocker since no delete-League feature exists, but unresolved
- the pre-existing Prisma P2002 constraint-metadata maintenance issue (see "Known maintenance issue — Prisma P2002 constraint metadata") — unrelated to Phase 5, still unresolved

### Future roadmap notes (not scoped as a phase)

Ideas discussed for a possible future phase, not yet scoped, designed, or implemented. Nothing below is committed work, informs any current-phase decision, or should be treated as a data-model/implementation change that has happened.

**Bot Managers + Mock Drafts — superseded by Phase 5 (Milestones 5.1–5.4 complete as of this update).** This subsection is preserved for historical/design-rationale context; it is no longer "unscoped" — see "Build phases" for the committed 5.1–5.6 milestone list, "Settled decisions" for what 5.1–5.4 actually locked in, and the Milestone 5.1/5.2/5.3/5.4 completed-work notes above for exactly what shipped. The bullets below predate implementation and are evaluated one at a time as each assumption turned out to hold or need adjustment:

- bots would be first-class draft participants, not fake OAuth `User`/`Account`/`Session` rows — no Auth.js identity is manufactured for a bot. **Held**: a bot is a `LeagueMember` row with `participantType = BOT`, never a fake `User`.
- bot picks would run server-side (most likely from `apps/socket-server`, alongside the existing turn-expiration sweep), never as browser-side automation. **Done in Phase 5.3**: the existing turn sweep gained a second phase, `runBotTurnSweep`, that discovers and processes BOT-current Drafts server-side — no browser/socket involvement, no fake client identity — see Milestone 5.3's completed-work notes.
- a bot's turn would reuse the same authoritative transactional pick pipeline (`submitPick`/`applyPick`) every other pick source already uses — no second pick-writing path. **Done in Phase 5.3**: `processBotDraftTurn` calls the identical `applyPick` (with the BOT's own `leagueMemberId`, `wasAutopick: false`) that `submitPick` and `processExpiredDraftTurn` already call — no second write path exists.
- a bot-manager pick is intentionally distinct from a human's timer-expiry autopick, even though both are machine-selected; a future `Pick` "source" concept might eventually distinguish `MANUAL`, `AUTOPICK` (timer expiry), and `BOT` (an intentional non-human manager) rather than overloading the existing `wasAutopick` boolean for both. **Deliberately not done in 5.1 or 5.3**: `Pick.leagueMemberId` joined against `LeagueMember.participantType` (plus `Pick.wasAutopick` for the human-autopick-vs-manual distinction) already lets a caller derive MANUAL/AUTOPICK(human)/BOT with zero new columns, so `PickSource` remains deferred until that derivation is shown to be insufficient.
- a first bot implementation would likely be a simple ADP/best-available selector, reusing the existing two-tier autopick approach; roster/position-aware bot strategy would be later, optional work. **Done (decision logic only) in Phase 5.2**: the two-tier ranking primitive was extracted from `autopick.ts` into the shared, exported `selectBestAvailablePlayerId`, with a rostered-eligibility correction applied along the way — see Milestone 5.2's completed-work notes. No bot turn actually calls it yet; that's Phase 5.3.
- a mock-draft mode could fill empty League slots with bots; a separately-discussed idea — temporarily delegating an existing real human's slot to CPU control — is a distinct, later concern from bot-owned mock-draft slots and should not be conflated with it. **Done in Phase 5.4**: `fillOpenLeagueSlotsWithBots`/`removeBotLeagueMembers` (`apps/web/lib/leagues/`) fill/clear empty League slots with bots, commissioner-only and pre-Draft only, exposed through the pre-draft page — see Milestone 5.4's completed-work notes. Temporary human-to-CPU delegation remains unscoped and explicitly out of 5.4's (as it was out of 5.1's) data model.

### Deferred decisions

- Socket authentication strategy — decide before Phase 3
- Railway vs. Fly.io for socket-server deployment — decide before Phase 7 (Deploy; renumbered from Phase 6 when Phase 5 was reassigned to Bot Managers + Mock Drafts — see "Build phases")

### Settled decisions

- Auth strategy: OAuth only
- Initial OAuth provider: GitHub
- Auth.js session strategy: database-backed sessions
- Auth.js persistence: Prisma adapter
- User-facing name field: `User.name`
- Prisma 7 runtime access: `@prisma/adapter-pg`
- `PlayerAdp.format` reuses `ScoringFormat`
- Supported scoring formats: `STANDARD` (non-PPR), `HALF_PPR`, and `PPR`
- ADP varies by scoring format only in this application, not by league size
- Fantasy Football Calculator's 12-team feed is the canonical ADP source for all league sizes
- 2026 is the current seed-data season
- Sleeper is the canonical source for player identity
- Draftable player positions are QB, RB, WR, TE, K, and DEF; IDP is not supported
- Team defenses match across sources by normalized NFL team code
- Individual players match primarily by normalized player name
- Team and position are secondary tiebreakers for ambiguous cross-source matches
- Unmatched or ambiguous records are never silently guessed
- Every Player has one PlayerAdp row per supported scoring format; missing current ADP is represented by `adp = null`
- Seed persistence is idempotent and atomic across all three scoring formats
- League HTTP mutations use Next.js Route Handlers; realtime draft mutations remain the socket server's responsibility
- League-creation endpoint: `POST /api/leagues`
- League-creation request bodies use strict Zod validation; unknown fields are rejected
- Invalid/malformed league-creation input returns HTTP `400`
- Unauthenticated league-creation requests return HTTP `401`
- Server-controlled fields such as `ownerId`, `userId`, and `draftSlot` are never accepted from client request bodies
- League ownership is derived from the authenticated Auth.js session
- League creation and creator membership creation occur atomically in one Prisma interactive transaction
- League creator receives `draftSlot = 1`
- League names are not unique
- League name validation: trimmed, 1–50 characters
- League roster size validation: integer 8–25, default 16 — **superseded for public input by Milestone 4.5's fixed-15-round product rule**: `rosterSize` is no longer a field the public create/update contracts accept at all (see the `PRODUCT_ROSTER_SIZE` decisions near the end of this list); this original bound remains true only of the internal service-level `createLeague()` parameter used by tests/fixtures
- League pick timer validation: integer 10–300 seconds, default 60
- Real-Postgres integration tests use a separate `fantasy_draft_test` database, never the development `fantasy_draft` database
- Destructive integration-test cleanup must hard-fail unless connected specifically to `fantasy_draft_test`
- `League.rosterSize` means players per fantasy roster; it is not league manager capacity
- `League.teamCount` is the league manager/team capacity
- `teamCount` validation: integer 4–20, default 12
- each League has a required unique immutable `inviteCode`
- invite codes are 8 characters from `ABCDEFGHJKMNPQRSTUVWXYZ23456789`
- invite-code input is case-insensitive by trimming and uppercasing before lookup
- malformed invite codes using characters outside the exact settled alphabet return `400`
- well-formed but unknown invite codes return `404`
- league join endpoint: `POST /api/leagues/join`
- join request body contains only `inviteCode`
- join identity is derived from the authenticated Auth.js session; clients never control `userId`, `leagueId`, or `draftSlot`
- duplicate league membership returns `409`
- league-at-capacity returns `409`
- league join concurrency is serialized with a row lock on the target `League`
- joining members receive the lowest available draft slot in `1..teamCount`
- draft-slot assignment does not assume slots are contiguous
- `(leagueId, userId)` and `(leagueId, draftSlot)` remain database-level unique constraints
- join-time Prisma `P2002` handling is constraint-specific, not generic
- invite-code rotation is deferred; invite codes are immutable for now
- League detail access is restricted to current `LeagueMember`s
- authenticated non-member access and nonexistent league IDs intentionally resolve to the same not-found behavior
- read-only league detail uses a Server Component calling a server-side service function directly; no GET Route Handler is required
- league-detail authorization is enforced in the Prisma query predicate, not after unrestricted data is loaded
- league detail is fetched in one Prisma query with selected relations; avoid N+1 reads
- league members are displayed in ascending `draftSlot` order
- all current LeagueMembers may view the persisted invite code
- league detail exposes only safe User fields: `id`, `name`, and `image`
- User email and Auth.js persistence data are not part of league-detail DTOs
- owner/commissioner status is derived from `League.ownerId`; no redundant role boolean is stored in the detail DTO
- `/leagues/[leagueId]` is the canonical league detail route
- Milestone 2.3 is read-only; commissioner settings and draft-slot mutations are deferred to Milestone 2.4
- Commissioner authority is represented by `League.ownerId`; there is no separate commissioner role field
- commissioner mutations require authentication and server-side owner authorization
- nonexistent league and authenticated non-member commissioner mutation attempts collapse to `404`
- authenticated LeagueMember who is not the owner receives `403` for commissioner-only mutations
- commissioner authorization and mutation occur inside the same Prisma transaction
- joins, commissioner settings updates, and draft-slot reorders all serialize on the target League row with `SELECT ... FOR UPDATE`
- pre-draft editable league settings are `name`, `rosterSize`, `teamCount`, `timerSeconds`, `scoringFormat`, and `draftType`
- `ownerId` is not client-editable
- invite codes remain immutable; invite-code rotation is deferred
- settings PATCH schemas use optional fields with no creation defaults
- empty settings PATCH bodies are invalid
- lowering `teamCount` must preserve both:
  - `teamCount >= current LeagueMember count`
  - `teamCount >= highest occupied draftSlot`
- settings updates do not implicitly reorder or compact draft slots
- draft-slot reordering uses full-order replacement, not partial slot patches
- reorder request shape is `{ memberIds: string[] }`
- draft-slot reorder uses `LeagueMember.id`, not `userId`, as the mutation key
- reorder input must contain every current LeagueMember exactly once
- server derives final draft slots as contiguous `1..N`
- draft-slot reorder preserves LeagueMember row identity
- transient draft-slot uniqueness collisions are avoided using temporary negative slots inside one transaction
- concurrent reorder requests use last-writer-wins semantics while preserving a complete valid ordering
- reorder racing with join may either:
  - reorder first and then allow the join, or
  - join first and cause the stale reorder to fail with `409`
- no schema migration is required for commissioner settings or draft-slot reordering
- Phase 2 is complete after Milestone 2.5 final verification
- Phase 2 multi-user and concurrency behavior may be verified through real-Postgres automated tests when additional real OAuth accounts are unavailable; additional OAuth accounts are not required solely for manual verification
- the League row is the documented application-level serialization primitive for membership/capacity/settings/reorder invariants
- membership uniqueness, draft-slot uniqueness, and invite-code uniqueness have database-level unique constraints
- `teamCount` capacity, draft-slot range, contiguous reorder, and related cross-row invariants are application-enforced behind the League-row lock rather than additional database CHECK constraints
- no additional database constraint/migration was required to close Phase 2
- expected domain failures use explicit `400`/`401`/`403`/`404`/`409` paths; `500` is reserved for unexpected failures
- Phase 2 DTOs use explicit allowlisted response shapes; raw Prisma records and Auth.js persistence fields are not exposed
- Phase 2 final verification is verification-first: no implementation changes are added unless verification identifies a concrete defect
- each League has at most one Draft; `Draft.leagueId @unique` is the database-level invariant
- draft creation and draft start are one operation in the current product
- draft-start endpoint: `POST /api/leagues/[leagueId]/draft`
- a Draft is created directly as `ACTIVE`; no separate PENDING lobby/create action is implemented
- only the League owner may start a draft
- starting requires `LeagueMember count === League.teamCount`
- empty manager/team slots are not supported at draft start
- draft start uses the League row as its serialization point with `SELECT ... FOR UPDATE`
- concurrent start attempts result in exactly one Draft
- the first picker is derived server-side from `getPickerForPickNumber(1, teamCount, draftType)`
- `turnDeadline` is server-owned and initialized from server time plus `League.timerSeconds`
- League settings are not snapshotted onto Draft
- League remains the current source of draft configuration
- once a Draft exists, league settings and draft-slot order are immutable
- `DraftStatus.PAUSED` is dormant; pause/resume behavior is not implemented
- `getPickerForPickNumber` is shared persistence-independent domain logic
- `packages/shared` must not depend on Prisma/database packages merely for domain enum types
- no Redis or Socket.IO coordination is needed for draft start

- Draft-row locking is the serialization mechanism for manual pick submission
- exactly one concurrent request may consume a given turn
- stale concurrent requests must re-read locked Draft state and fail after another request advances the turn
- application pre-checks improve domain errors, but database uniqueness constraints remain the final concurrency backstop
- `(draftId, playerId)` uniqueness prevents the same Player from being drafted twice
- `(draftId, pickNumber)` uniqueness prevents two Pick rows from owning the same overall pick
- manual Picks always persist `wasAutopick = false`
- total Draft length is `teamCount * rosterSize`
- a completed Draft retains the final `currentPickNumber` and clears `currentMemberId` (renamed from `currentUserId` by Phase 5.1 — see the Phase 5.1 identity-split bullets below) and `turnDeadline`
- successful non-final Picks receive a fresh server-owned deadline based on `League.timerSeconds`
- transactional pick submission currently belongs to `apps/web`; do not import `apps/web` implementation code directly into `apps/socket-server`
- Milestone 3.3 must explicitly determine the reusable service/package boundary before Socket.IO consumes authoritative draft mutations
- `packages/shared` remains persistence-independent and must not depend on Prisma
- shared Prisma-dependent application services may live in `packages/database`
- `apps/web` and `apps/socket-server` must consume shared persistence services rather than duplicating draft transaction logic
- `apps/socket-server` must not import implementation code from `apps/web`
- HTTP transport validation remains owned by `apps/web`
- Socket.IO transport validation will be owned by the socket transport boundary unless a genuinely transport-independent schema is later justified in `packages/shared`
- realtime authentication uses short-lived, single-use Postgres-backed `SocketTicket` records
- socket authentication establishes identity only; League/draft authorization remains a separate server-side check
- Postgres remains authoritative for draft correctness
- Socket.IO must not introduce an in-memory correctness boundary for pick submission
- 3.3 uses full authoritative draft-state synchronization rather than incremental-only client state
- HTTP-originated picks do not require an immediate Socket.IO broadcast in 3.3
- cross-process publication is deferred rather than implementing a temporary HTTP broadcast bridge
- presence is deferred
- Redis is not required for 3.3
- persistence-independent draft-state DTO types belong in `packages/shared`; Prisma query/mapping logic remains in `packages/database`
- Socket.IO authentication uses the Postgres-backed SocketTicket mechanism
- socket identity must come exclusively from consumed SocketTicket state, never client event payloads
- Socket.IO payload schemas are strict and reject unknown fields
- realtime League rooms use `league:${leagueId}`
- socket request/domain failures use acknowledgement error codes
- there is no standalone `pick:rejected` event
- successful socket picks broadcast one full authoritative `draft:state`
- draft completion is represented through `draft:state`, not a separate `draft:complete` event
- multiple simultaneous sockets for one authenticated user are valid
- reconnects mint a fresh SocketTicket and resync through `draft:join`
- Socket.IO is a delivery layer; Postgres remains the draft correctness boundary
- HTTP-originated mutations are not bridged into Socket.IO in 3.3
- do not add a temporary HTTP-to-socket broadcast bridge
- Redis remains deferred until cross-process/multi-instance realtime publication is actually required
- Postgres remains the sole authoritative correctness boundary for turn expiration and autopick, exactly as it already is for manual pick submission
- `apps/socket-server` owns turn-deadline polling; it is not owned by `apps/web` or by a database-level background job
- turn expiration uses one recurring sweep, not one timer per Draft
- the sweep interval currently defaults to 2000ms and is configurable per call for tests; it is not an environment variable
- manual pick submission and automatic turn expiration serialize on the identical Draft-row lock; neither can consume a turn the other has already consumed
- a sweep pass that finds a turn already advanced (by a manual pick or another sweep pass) is a routine no-op, not an error
- autopick selection order is: lowest available ADP for the League's scoring format, then lowest `searchRank` (nulls last), then `id` ascending as a final deterministic tiebreak — as of Phase 5.2 this ranking rule lives in the shared, exported `selectBestAvailablePlayerId` (`packages/database/src/drafts/player-selection.ts`), not private to autopick; see "Turn-expiration and autopick conventions"
- autopick does not yet consider roster position
- as of Phase 5.2, automated selection (`selectBestAvailablePlayerId`) is scoped to rostered players only (`Player.nflTeam IS NOT NULL`), matching the Phase 4.3 Available Players UI pool — before 5.2, human timer-autopick's candidate pool had no such restriction and could theoretically select a player invisible to the drafting UI; this was an intentional correction, not a new restriction on human manual picks (`submitPick`/`applyPick` remain pool-agnostic)
- Socket.IO broadcasts authoritative state only after a real (non-no-op) turn-consuming mutation, manual or automatic
- restart recovery for timer/autopick state comes from rediscovering expired deadlines in Postgres on the next sweep tick, not from reconstructing in-memory timers
- the basic reconnect/resync mechanism (fresh SocketTicket, reconnect, `draft:join`, authoritative resync) was delivered in 3.3b and required no changes for 3.4; it already reflects any autopick-driven state that occurred while a client was disconnected
- `/leagues` lists Leagues by `LeagueMember` membership only; League ownership is never queried separately for this purpose
- Phase 4 milestones are: 4.1 Commissioner Draft Start UI, 4.2 Draft Room Shell + Live Turn State, 4.3 Available Players + Search/Filtering, 4.4 Production Pick Submission UX, 4.5 Pre-Draft Experience + Live Draft Room, 4.6 Draft Room UX Hardening + Phase 4 Closeout
- Phase 4 pick submission remains server-authoritative and ack/state-driven; the client renders what `draft:state` and pick acknowledgements say rather than applying an optimistic local update that later rolls back
- `getLeagueDetail` exposes draft existence as `draft: { id: string } | null`; `status` is intentionally not included because Milestone 4.1 only needs existence — extend the DTO later only when a milestone actually needs more
- `/leagues/[leagueId]` renders draft entry/start state conditionally rather than an unconditional Draft Room link
- draft-start UI lives in `apps/web/app/leagues/[leagueId]/start-draft-form.tsx` and calls the existing `POST /api/leagues/[leagueId]/draft` endpoint unchanged; no second draft-start path exists
- a disabled Start Draft control with membership-progress copy is shown to the commissioner while the league is underfilled; the control is hidden entirely (not just disabled) for non-commissioners
- a successful draft start navigates the browser to `/leagues/[leagueId]/draft` via `router.push`
- draft-start errors are mapped to short user-facing copy by HTTP status rather than parsed from the server's error message string
- the draft-start endpoint's `409` is ambiguous between "already started" and "not full" with no structured code to disambiguate; the UI does not guess — it shows a generic "state changed" message and calls `router.refresh()` to re-derive the correct view from authoritative server state
- Milestone 4.1 introduced no new frontend state-management infrastructure and no Socket.IO/Phase 3 engine/schema/`packages/shared`/`packages/database` changes
- `teamCount`'s minimum (currently 4) is not relaxed for local testing convenience; a `teamCount = 1` league is not a legitimate way to manually exercise the full-league draft-start path
- `DraftRoomClient` is the single owner of both the Socket.IO connection and the authoritative `DraftStateResult`; child presentational components receive derived props rather than owning any draft state themselves
- current-picker name, `"your turn"`, draft phase, and countdown are always derived from authoritative state (plus authenticated `currentUserId` and a local `now` tick for the countdown) rather than stored as independent state
- connection UI state (`"connecting" | "connected" | "reconnecting" | "error"`) is presentation-only and does not affect draft correctness
- `socket.active` is the basis for distinguishing a Socket.IO failure that will retry automatically from one that will not, rather than assuming every `connect_error`/`disconnect` behaves the same way
- Socket.IO Manager-level reconnection events (`reconnect_attempt`, `reconnect_failed`) must be registered on `socket.io`, not `socket` — the installed socket.io-client version does not define them on `Socket` itself
- client-side turn countdowns are cosmetic only; they must never advance the draft, trigger autopick, mutate authoritative state, or disable functionality on their own
- the temporary manual player-ID pick form remains a labeled debug/development control through Milestone 4.3; Milestone 4.4 owns replacing it with production pick UX
- no new frontend state-management library (Redux/Zustand/Context/reducer) will be introduced for draft-room state unless a later milestone demonstrates a concrete need beyond derived-from-authoritative-state logic
- Tailwind CSS is named in this document's Stack table but is not currently installed anywhere in the repository; no styling framework was added in Milestone 4.2, and this mismatch is a documentation/styling-system decision to revisit later rather than a statement that Tailwind exists today
- the production draft-room player-discovery pool is defined as `Player.nflTeam IS NOT NULL`; expanding discovery to free agents or other provider records would be a future explicit product/data decision, not something the temporary debug pick form is meant to compensate for
- player discovery uses one server-side `getAvailablePlayers(scoringFormat)` fetch per page load; no player-search API route, pagination, virtualization, debounce, or per-keystroke network request was introduced
- the fetched player pool is passed into `DraftRoomClient` and filtered client-side; `DraftRoomClient` remains the sole authoritative draft/socket-state owner
- drafted player IDs are derived from authoritative `state.picks`; no second mutable drafted-player collection exists
- search/position-filter state lives locally in `AvailablePlayersPanel`, not in `DraftRoomClient`
- available-player search is trimmed, case-insensitive, partial `fullName` matching only; position filters are `All | QB | RB | WR | TE | K | DEF`; search and position filter combine with AND
- the available-player table displays Player / Pos / Team / ADP with no Rank column — a rank derived from the currently filtered result set would misleadingly resemble an overall fantasy ranking; missing ADP displays as `—`
- available-player ADP is selected using the league's own `scoringFormat`; ordering is ADP ascending (nulls last), then `searchRank` ascending (nulls last), then deterministic `id` ascending; `searchRank` is an ordering input only and is never rendered
- Prisma 7.9.1 supports `{ sort, nulls }` ordering on a nested to-one relation field natively, so the available-players query needed no fallback ordering implementation
- the `AvailablePlayer` DTO is a narrow web-only DTO in `apps/web/lib/players`, following the same convention as `LeagueDetailResult`/`MyLeagueSummary` — not a raw Prisma model, and not moved into `@fdm/shared`
- the old `/players` verification route remains untouched/superseded, not removed
- the temporary manual `playerId` debug form remains until Milestone 4.4, which is where the current player rows become the production pick-submission UX, with Draft actions replacing the temporary raw player-ID workflow
- Phase 3 `submitPick` correctness was not modified for Milestone 4.3; Postgres/`submitPick` remains the sole authority on pick validity regardless of what the discovery panel shows
- no roster-position enforcement or roster-aware filtering was added in Milestone 4.3
- production draft-room pick submission uses the existing Socket.IO `draft:pick` event; the HTTP pick route remains available but is not used by the production draft-room action, because successful HTTP-originated picks are not bridged into Socket.IO broadcasts and would leave the room stale
- no Phase 3 protocol shapes (`draft:pick`/`draft:join`/`draft:state`/ack contracts) changed for Milestone 4.4
- Draft-button enablement is a client-side UX convenience gated on `phase === "ACTIVE"`, authoritative on-the-clock status, `status === "connected"`, and no pending request; it is never the correctness boundary — `submitPick`/PostgreSQL still validate and can still reject independently of what the client believes
- no optimistic picks: no local player removal, pick append, turn advancement, pick-number advancement, `currentUserId` mutation, or deadline prediction is introduced anywhere in the draft room
- a successful `{ ok: true }` `draft:pick` ack carries no state and must not itself mutate `DraftStateResult`; only the subsequent authoritative `draft:state` broadcast (received by the submitting socket itself, since it is already in the League room) updates client state on success
- `draft:join`'s ack and the `draft:state` listener apply authoritative snapshots through one shared function (`applyAuthoritativeState`); there is exactly one place client-side authoritative state is ever applied
- `pendingPlayerId` (user-visible) plus a synchronous `useRef`-based in-flight guard together prevent duplicate `draft:pick` emits from rapid double-clicks; the ref guard is a UX duplicate-emission guard only and does not replace or weaken server-side Draft-row locking
- while a pick is pending, every Draft button disables; only the selected row shows `Drafting…`
- a rejection ack, a fresh authoritative state application, and a socket disconnect all clear `pendingPlayerId`/the in-flight guard; disconnect clears them unconditionally rather than guessing whether an in-flight pick committed, and reconnect's fresh `draft:join` resync is what determines the actual truth
- no automatic pick retry and no exactly-once client protocol was added
- `SocketErrorCode` → user-facing message mapping is exhaustive (`Record<SocketErrorCode, string>`) and lives in a pure, DOM-free helper (`pick-submission-helpers.ts`) alongside the pure Draft-button gating helper (`canSubmitPick`); no jsdom/React Testing Library was introduced to test either
- the rare edge where a pick's commit and success ack both succeed but its subsequent `draft:state` broadcast is lost while the socket stays connected (leaving client pending state stuck with no further signal) was deliberately not addressed in 4.4; Milestone 4.6 resolved it with a client-initiated `draft:join` resync triggered directly off the successful ack
- the temporary raw `playerId` debug form was removed from the normal production draft-room UI in Milestone 4.4; arbitrary/invalid player-ID behavior remains covered by the existing automated server-side tests
- the Available Players table displays a stable integer **ADP Rank** — each player's 1-indexed position within the full ADP-sorted pool — instead of the raw decimal `PlayerAdp.adp` value; the rank is never derived by rounding/flooring the raw ADP
- ADP Rank is computed client-side (`computeAdpRanks` in `available-players-helpers.ts`) from the full, unfiltered player pool, never from the currently filtered/searched subset, so a player's rank stays fixed regardless of search or position filtering
- a player with `adp === null` remains unranked (displays `—`); no ADP Rank is invented for a player with no ADP
- persisted `PlayerAdp.adp`, server-side available-player ordering, and autopick selection are unaffected by ADP Rank — it is a presentation-only client-side derivation
- pre-draft planning/viewing and live drafting are two distinct routes: `/leagues/[leagueId]/draft` (stable pre-draft/draft-summary page, never opens Socket.IO) and `/leagues/[leagueId]/draft/room` (live draft room, the only place Socket.IO connects)
- `/leagues/[leagueId]/draft/room` redirects (server-side `redirect()`) back to `/leagues/[leagueId]/draft` when no Draft exists yet; the pre-draft page never redirects and instead renders one of three bodies in place (no-Draft planning view / ACTIVE summary+Join link / COMPLETE summary+View link) so it stays a stable, bookmarkable URL through every Draft state
- "Join Draft Room" is navigation into the live room, not a second membership concept — the user is already a `LeagueMember`; no persisted "draft-room membership" table/model exists or is needed; joining the live room still goes through the existing SocketTicket → Socket.IO → `draft:join` flow unchanged
- "Start Draft" (commissioner-only HTTP mutation) and "Join Draft Room" (navigation) are semantically distinct and never conflated; a successful Start Draft navigates the commissioner directly into `/draft/room`
- commissioner status for pre-draft page rendering is determined by `getLeagueDetail(...).league.ownerId === currentUserId`, the same authority source every other commissioner-only UI already uses — never inferred from `draftSlot` or from `DraftStateResult`; this is presentation-only, and `startDraft`'s own server-side owner authorization remains the actual authoritative check
- `getLeagueDetail`'s `draft` field is `{ id: string; status: DraftStatus } | null` (widened from existence-only in Milestone 4.5) — still a web-only DTO, never crossing into `@fdm/shared` or the socket transport
- `/leagues/[leagueId]` (league detail) exposes a single stable "View Draft" link into `/leagues/[leagueId]/draft` for every role and every Draft state; commissioner Start Draft branching/control lives exclusively on the pre-draft page and is never duplicated on league detail
- one shared, pure `deriveDraftBoard(state: DraftStateResult)` is the only board-geometry implementation, reused unmodified by the pre-draft page (fed a locally-constructed `DraftStateResult`-shaped value with `draft: null, picks: []`) and the live room (fed the real authoritative state); rows come from `state.league.rosterSize`, columns are the fixed `draftSlot` order and never reverse, and cell-slot mapping reuses the existing shared `getPickerForPickNumber`
- completed board cells come only from authoritative `state.picks`; the current-pick cell highlights only while `status === "ACTIVE"`, derived from `currentPickNumber`; cell player metadata comes directly from `DraftStatePick`, never joined against the separate 4.3 rostered-only `AvailablePlayer` discovery pool
- one shared, pure `deriveTeamRosters(state: DraftStateResult)` groups authoritative `state.picks` by member/user in `state.members`'s existing `draftSlot` order; the live room's roster panel defaults to the authenticated user's own roster with a simple selector for any other manager, rather than stacking every team's roster at once; no starter/bench concept and no roster-position enforcement exist
- `AvailablePlayersPanel`'s `onDraft`/`canDraft`/`pendingPlayerId` props are optional; omitting `onDraft` is what puts the panel into read-only mode (no Action column) for the pre-draft page, while the live room continues supplying all three unchanged from Milestone 4.4 — there is exactly one player-list implementation, not two
- current product behavior: newly created leagues are fixed to a 15-round draft via `PRODUCT_ROSTER_SIZE = 15` in `apps/web/lib/leagues/schema.ts`
- the public `createLeagueInputSchema` and `updateLeagueSettingsInputSchema` no longer have a `rosterSize` field at all — a client that sends one is rejected by `.strict()` exactly like an `ownerId` spoofing attempt, not range-validated
- `POST /api/leagues` always injects `rosterSize: PRODUCT_ROSTER_SIZE` before calling `createLeague()`; there is no product/API path to set or later change a League's round count
- `create-league-form.tsx` and `league-settings-form.tsx` expose no roster-size input
- the service-level `createLeague()` retains its own broader `CreateLeagueInput` type (`CreateLeagueApiInput & { rosterSize: number }`) distinct from the public schema-inferred type, so internal tests/fixtures needing a non-15 `rosterSize` keep calling it directly, unaffected by the public boundary change
- `rosterSize` remains the domain/database/engine representation of round count and remains fully dynamic at the engine layer: Phase 3 completion (`totalPicks = teamCount * rosterSize`), autopick, and the Milestone 4.5 board derivation all continue reading `league.rosterSize`/`state.league.rosterSize` — no engine-level literal `15` was introduced, preserving future configurability without exposing it in the current product
- no DB migration was required for the 15-round product rule; `rosterSize` was already a plain, unconstrained `Int` column, so historical League rows with non-15 values (e.g. `16`) continue to work unchanged using their own stored value
- Milestone 4.6 is UX hardening/accessibility/responsive polish plus one correctness-adjacent client fix (the pick-success resync); it introduced no Phase 3 protocol, schema, `packages/shared`, or `packages/database` changes
- responsive layout uses one small route-scoped stylesheet (`draft-room.css`, imported via a route-segment `layout.tsx`) rather than a styling framework; inline `style` props remain the default everywhere CSS capabilities (media queries, shared computed classes) aren't specifically required
- `DraftBoard` column headers are built from every configured `1..teamCount` slot, not from `state.members`, so header/column alignment is always correct even for an underfilled pre-draft league
- the current-pick highlight always takes visual precedence over the authenticated-user-column highlight on a shared cell (enforced via a combined CSS selector, not declaration order); neither highlight relies on color alone
- position accents (`position-style.ts`) are supplementary only; every caller keeps rendering the actual position text alongside the accent
- a `COMPLETE` Draft hides `AvailablePlayersPanel`'s Action column entirely (via `shouldShowActionColumn`, reusing the panel's existing optional-`onDraft` read-only mode) rather than rendering permanently-disabled Draft buttons
- a successful `draft:pick` ack triggers an immediate client-initiated `draft:join` resync rather than only waiting on the room-wide `draft:state` broadcast; this reuses the existing `draft:join` event and `applyAuthoritativeState` function with no protocol/ack-shape change
- a resync failure (the `draft:join` ack itself rejected) is never presented as "the pick failed" — the original `draft:pick` ack already confirmed the commit; the client shows a distinct refresh-guidance message instead
- multiple valid authoritative `DraftStateResult` snapshots may arrive for one pick (the resync's own, and/or the room broadcast); wholesale replacement on each is always safe, and this is not treated as a literal no-op when a snapshot repeats
- no defensive timeout was added for the resync's own ack being lost; that residual case is accepted as bounded by Socket.IO's heartbeat-driven `disconnect`, not defended against directly
- accessibility conventions going forward: native semantics first, `scope="col"`/`scope="row"` table headers, real (visually-hidden where appropriate) form labels, player-specific accessible button names, `role="alert"` for errors, `role="status" aria-live="polite"` scoped narrowly to infrequent status changes (never wrapping a per-second-updating countdown), native focus outlines never removed, color never the sole carrier of state/position meaning
- Phase 5.1 identity split: `User.id` is authentication identity (Auth.js/session identity, SocketTicket/socket authentication, commissioner/owner authorization, human membership lookup by `(leagueId, userId)`); `LeagueMember.id` is draft participant identity (draft-slot ownership, current-turn ownership, pick attribution, HUMAN or BOT alike) — these were the same thing for every participant before bots existed
- bots are never fake Users — no `User`/`Account`/`Session`/`SocketTicket` row is ever created for a bot; a bot's durable identity is its own `LeagueMember.id`
- `LeagueMember.participantType` is `LeagueMemberType.HUMAN | LeagueMemberType.BOT`, defaulting to `HUMAN`
- `LeagueMember.userId` is nullable; `LeagueMember.displayName` is a new BOT-only nullable field
- HUMAN shape: non-null `userId`, null `displayName`. BOT shape: null `userId`, non-null `displayName`
- the HUMAN/BOT shape invariant is enforced by a hand-written database `CHECK` constraint, not by TypeScript — Prisma 7.9.1 has no `@@check` schema DSL (confirmed via `prisma validate` against a scratch schema before writing the Phase 5.1 migration); this constraint is invisible to `schema.prisma` and must be preserved by hand if `LeagueMember` is ever touched by a bare `prisma migrate dev`
- `@@unique([leagueId, userId])` and `@@unique([leagueId, draftSlot])` are unchanged by Phase 5.1
- a duplicate non-null human membership is still rejected by `@@unique([leagueId, userId])`; multiple BOT rows (`userId = null`) coexist under the same constraint via PostgreSQL's standard (non-version-gated) NULL-distinct unique-index behavior — verified with a real-Postgres integration test, not assumed from documentation
- `draftSlot` uniqueness remains the sole positional authority for both HUMAN and BOT rows; no second slot-ownership table exists
- `Draft.currentUserId` is removed; `Draft.currentMemberId` (FK → `LeagueMember.id`, `onDelete: SetNull`) is the participant currently on the clock — a live pointer, not historical attribution, so it may be cleared safely
- `Pick.userId` is removed; `Pick.leagueMemberId` (FK → `LeagueMember.id`, `onDelete: Restrict`) is a Pick's historical attribution — required, and deliberately not cascade-deletable, so deleting a `LeagueMember` who has ever picked fails loudly rather than silently erasing draft history
- current-turn identity and pick attribution both moved from user identity to participant identity because a bot can be on the clock or own a pick with no `User` row to point to; pick history must support both humans and bots without inventing a fake human
- `startDraft`'s fullness rule is unchanged (`LeagueMember count === teamCount`); a BOT row counts toward that total exactly like a HUMAN row; only the first-picker write changed, from `firstPicker.userId` to `firstPicker.id` (written to `Draft.currentMemberId`)
- `submitPick`'s public signature and human-facing behavior are unchanged; internally: resolve the requesting human's own `LeagueMember` by `(leagueId, userId)` → compare that membership's `.id` to `Draft.currentMemberId` → write `Pick.leagueMemberId` as that membership's `.id`. Public/manual human pick APIs remain user-authenticated; bots never use this authenticated-user path
- `processExpiredDraftTurn` (timer-expiry autopick) now reads/writes `currentMemberId`/`leagueMemberId`; no intended behavior change for human autopick
- the risk noted at 5.1 time — that autopick did not inspect `participantType`, so a BOT's expired turn would be processed exactly like a human's — is **resolved as of Phase 5.3**: `processExpiredDraftTurn` now authoritatively re-checks `participantType === HUMAN` after locking the Draft row, and a parallel `processBotDraftTurn` service handles BOT turns instead. See the Phase 5.3 bullets below and "Turn-expiration and autopick conventions."
- member-facing DTOs normalize HUMAN/BOT presentation to one shape: `{ membershipId, participantType, userId: string | null, name, image, draftSlot }`, resolved as `HUMAN → name = user.name, image = user.image` and `BOT → name = displayName, image = null`
- UI components read the already-normalized `name`/`image` and never branch on `user.name ?? displayName` themselves
- roster/member-order selection keys (`TeamRosterPanel`, `deriveTeamRosters`, `member-order-form.tsx`) use `membershipId`, never `userId`, precisely because `userId` is null and non-unique across bots — this is load-bearing, not stylistic: keying by `userId` would collapse every bot onto the same selector value once more than one bot exists in a league
- Phase 5.1's migration backfill was verified twice: once implicitly against the (actually empty) dev database, and explicitly against a disposable database seeded with populated pre-5.1-shaped data (2 Users, 1 League, 2 LeagueMembers, an ACTIVE Draft with an old `currentUserId`, and 2 Picks with an old `userId`) — `Draft.currentMemberId` and both `Pick.leagueMemberId` values resolved correctly, row counts and pick/player/autopick fields were unchanged, and the migration's own internal verification blocks did not fire
- deleting a League with Draft/Pick history currently fails at the database level (`Pick_leagueMemberId_fkey` `Restrict` trips before the `Draft`/`Pick` cascade completes) — verified, transactional/clean, not a current product blocker since no delete-League feature exists, but it must be resolved before one ships; see "Known issue — League deletion blocked by Pick → LeagueMember FK ordering"
- `wasAutopick` is unchanged by Phase 5.1; no `PickSource` field was added — `Pick.leagueMemberId` joined against `LeagueMember.participantType` already lets a caller derive MANUAL/AUTOPICK(human)/BOT with zero new columns, so `PickSource` stays deferred until that derivation is shown to be insufficient
- Phase 5.1 introduced no bot player selection, bot turn scheduler, automatic bot picks, mock-draft UI, fill-empty-slots UI, strategy/difficulty/seed fields, position-aware bot drafting, temporary human-to-CPU takeover, fake OAuth identities, or socket/auth changes; it did not touch the pre-existing P2002 constraint-metadata maintenance issue
- Phase 5.2 settled decisions: `selectBestAvailablePlayerId(tx, { draftId, scoringFormat })` (`packages/database/src/drafts/player-selection.ts`, exported publicly) is the one shared, deterministic BEST_AVAILABLE ranking primitive; automated selection (human timer-autopick and, as of 5.3, BOT selection) is scoped to rostered players only (`Player.nflTeam IS NOT NULL`), matching the Phase 4.3 Available Players UI pool; tier 1 orders `adp ASC, searchRank ASC NULLS LAST, id ASC`, falling back to `searchRank ASC NULLS LAST, id ASC`; the selector returns `null` on exhaustion and never throws — each caller defines its own exhaustion semantics
- Phase 5.3 settled decisions — single-sweep BOT orchestration:
  - BOT turn orchestration reuses the existing `apps/socket-server` turn sweep; there is one `startTurnSweep`/`stopTurnSweep`, one self-rescheduling timer, one configured interval — never a second bot-specific timer/lifecycle, and never immediate/recursive bot-chaining
  - `runSweepOnce(io)` is two sequential phases per tick: `runHumanExpirySweep(io)` (the pre-5.3 sweep body, unchanged) then `runBotTurnSweep(io)` (new); the sweep remains non-overlapping exactly as before
  - human timer-expiry discovery (`findExpiredActiveDraftLeagueIds`) additionally filters to `currentMember.participantType = HUMAN` as a discovery-time efficiency filter; this is never the authoritative check
  - the authoritative HUMAN/BOT check is always post-lock: `processExpiredDraftTurn` re-reads the locked Draft's current `LeagueMember.participantType` and returns `{ outcome: "skipped", reason: "CURRENT_PARTICIPANT_IS_BOT" }` if it isn't `HUMAN`, before ever evaluating `turnDeadline` — discovery filters early, but only the locked re-read is trusted, since participant identity can change between an unlocked discovery read and lock acquisition
  - BOT discovery (`findActiveBotTurnLeagueIds`, `packages/database/src/drafts/bot-turn.ts`) matches `Draft.status = ACTIVE AND currentMember.participantType = BOT` with **no** `turnDeadline` condition at all — a BOT's turn is never gated on any deadline elapsing; no new database index was added for this query, matching the existing scale assumption behind `findExpiredActiveDraftLeagueIds`
  - `processBotDraftTurn(leagueId)` is the public, high-level BOT-turn service: lock Draft row → no Draft?/not ACTIVE? skip → re-read current `LeagueMember` → not BOT? skip (`NOT_BOT_TURN`) → read League config → `selectBestAvailablePlayerId` inside the same transaction → `null`? throw `BotPickExhaustedError` → `applyPick` (BOT's own `leagueMemberId`, `wasAutopick: false`) → commit. `lockDraftForLeague`/`applyPick` remain internal `@fdm/database` primitives, never exported; there is exactly one Pick-writing path in the whole system, shared by manual picks, human autopick, and BOT picks alike
  - **no schema/deadline-algorithm change**: `applyPick`'s existing "advance to next picker" branch writes `turnDeadline = now + timerSeconds` identically regardless of whether the next current participant is HUMAN or BOT. Routing is entirely `participantType`-driven — for a HUMAN, `turnDeadline` gates timer-expiry eligibility as before; for a BOT, `participantType` alone gates BOT-sweep eligibility, and the stored deadline carries no wait requirement
  - transitions: HUMAN→BOT may be processed within the **same** `runSweepOnce` tick (the BOT-phase discovery query runs, and sees committed state, only after the human phase fully completes) — verified by a dedicated test, not just reasoned from code; BOT→BOT processes exactly one pick per league per tick (no recursion/inner loop), so a BOT chain drains across multiple ticks, one pick per tick; BOT→HUMAN resumes ordinary timer-expiry behavior unmodified
  - BOT picks persist `wasAutopick: false` — a BOT's own intentional pick is not "a human missed their deadline"; `wasAutopick` keeps its pre-5.3 meaning exactly, and a Pick's origin (manual / human-autopick / BOT) remains derivable from `Pick.leagueMemberId` joined against `LeagueMember.participantType` plus `Pick.wasAutopick`, with zero new columns — `PickSource` remains deferred
  - `BotPickExhaustedError` (distinct from `AutopickExhaustedError`) is thrown inside the transaction on selector exhaustion, rolling back completely (no Pick, no `currentPickNumber`/`currentMemberId` change, Draft stays `ACTIVE` with the same BOT current); the sweep logs and continues to the next league; no product-facing recovery UI exists
  - broadcast split unchanged: `packages/database` never imports/emits Socket.IO; `apps/socket-server`'s `runBotTurnSweep` calls the existing `broadcastDraftState(io, leagueId)` only on a `"picked"` outcome; bots never connect a socket or mint/consume a SocketTicket
  - restart/zero-client behavior is a byproduct of the same live-Postgres-discovery mechanism the human sweep already had — no in-memory-only trigger exists anywhere in BOT orchestration
  - concurrent `processBotDraftTurn` calls for the same BOT turn resolve via the same Draft-row lock every other pick path already uses: whichever transaction locks first applies the Pick, the second re-reads post-commit state and returns a normal skip. PostgreSQL row locking remains the sole mutation-correctness boundary; no Redis/distributed lock was added or is required for this invariant, regardless of whether duplicate calls originate from one process or a future multi-instance deployment — only operational scheduling, not this transaction guarantee, would change with future scaling work
  - confirmed by direct test that a HUMAN cannot submit a pick "as" a BOT while one is current: a human's own membership always resolves via `(leagueId, userId)` to their own non-BOT row, which cannot equal a BOT's `currentMemberId`; `submitPick`'s existing, unmodified `NotOnTheClockError` check already rejects this — no new BOT-authorization guard was added or needed
  - Phase 5.3 introduced no mock-draft creation UI, fill-empty-slots UI, bot strategy configuration, position-aware strategy, randomness/difficulty/personality, BOT-specific visual badge, temporary human-CPU takeover, `PickSource`, browser-side bot logic, fake OAuth/Auth.js identity, or Redis/queue infrastructure; **no production path creates a BOT `LeagueMember`** — that remains Phase 5.4's job
  - workspace tooling finding (not a Phase 5.3 design decision, but discovered and fixed during its verification): both `apps/socket-server` and `apps/web` resolve `@fdm/database` through the pnpm workspace symlink, whose `package.json` `"exports"` field points at built `dist` output — neither app ever consumes `packages/database/src` directly, so a consuming package's tests can silently run against stale `@fdm/database` output if the dependency wasn't rebuilt after a source change. This is how five `apps/socket-server` sweep-test fixtures were found still creating teamless (`nflTeam: null`) Players for the automated-selection path after Phase 5.2's rostered-eligibility change — Milestone 5.2's own verification pass had run those tests before that session's final rebuild. Fixed by rostering the five fixtures; `apps/web` is equally exposed in principle but has no current test that exercises the affected path. See "Integration testing conventions" for the resulting convention.
- Phase 5.4 settled decisions — Fill/Remove Bots + draft-position discoverability:
  - `fillOpenLeagueSlotsWithBots(leagueId, requestingUserId)` (`apps/web/lib/leagues/fill-bots.ts`) and `removeBotLeagueMembers(leagueId, requestingUserId)` (`apps/web/lib/leagues/remove-bots.ts`) are the two Phase 5.4 services; both live in `apps/web/lib/leagues`, not `packages/database` — this is commissioner HTTP membership-management, the same category as `join-league.ts`/`reorder-league-members.ts`/`update-league-settings.ts`, never called from `apps/socket-server`, so it belongs with its siblings rather than with the cross-transport draft-engine primitives in `@fdm/database`
  - both reuse `authorizeLeagueOwner` (League-row `FOR UPDATE` lock + ownership check) and `getDraftForLeague` (draft-existence guard) exactly as `reorderLeagueMembers`/`updateLeagueSettings`/`startDraft` already do — no second lock primitive was introduced for bots
  - Fill computes every open `draftSlot` in `1..teamCount` from a read taken *inside* the lock, then creates one BOT `LeagueMember` per open slot via a single `createMany`, all in one transaction — there is no gap between "read what's open" and "create bots for it" for another transaction to land in
  - Fill is idempotent (`botsCreated: 0`, not an error, when no slots are open); Remove is idempotent (`botsRemoved: 0`, not an error, when no bots exist)
  - Remove's `deleteMany` is scoped to `participantType: "BOT"` only — it can never touch a HUMAN row, and removing a bot pre-Draft never touches the `Pick.leagueMemberId` `Restrict` FK, since a pre-Draft bot has no Picks
  - BOT `LeagueMember.displayName` is a stable ordinal (`"CPU 1"`, `"CPU 2"`, …), assigned in ascending open-slot order for that Fill call and continuing from the count of BOT rows already in the league — deliberately never derived from `draftSlot`. This was a deliberate choice to avoid a slot-based name going stale after a later reorder; `draftSlot` alone is authoritative for draft position, and `displayName` never claims otherwise, at any point
  - two concurrent Fill calls, and a concurrent HUMAN `joinLeague` vs. Fill, both resolve deterministically because `joinLeague`'s own `SELECT ... FOR UPDATE` and `fillOpenLeagueSlotsWithBots`'s `authorizeLeagueOwner` lock the identical League row — no coordinated code change was required for this; it is a direct consequence of both operations already locking that row. Verified with dedicated real-Postgres concurrency tests, not merely reasoned about
  - `POST /api/leagues/[leagueId]/bots/fill` and `DELETE /api/leagues/[leagueId]/bots` accept no request body — every field either operation needs is server-derived, so there is no client-controlled BOT payload (`participantType`, `displayName`, `draftSlot`, bot count) to validate or reject
  - status mappings reuse existing error classes unchanged: `401` unauthenticated, `404` `LeagueNotAccessibleError`, `403` `NotLeagueOwnerError`, `409` `DraftAlreadyStartedError`; a successful or idempotent-no-op Fill/Remove is `200` in every case — Fill never returns `201`, since "fill open slots" can legitimately create zero rows. No `BotFillConflictError` and no new P2002 target-inspection path was added; the League-row lock is treated as the actual product-level concurrency guarantee, and the pre-existing P2002 constraint-metadata maintenance issue remains deferred and untouched
  - **the existing `reorderLeagueMembers` requires no changes to support a mixed HUMAN/BOT membership list** — it was already written purely in terms of submitted `LeagueMember.id`s and final array order, with zero reference to `participantType`/`userId`/`displayName` anywhere in its implementation. This was verified directly with dedicated LINEAR and SNAKE real-Postgres integration tests (Fill → reorder the HUMAN off slot 1 → Start Draft → process BOT turns via the existing `processBotDraftTurn` → confirm the HUMAN becomes current at their chosen slot, including across a SNAKE round boundary), not merely asserted from reading the code
  - a commissioner is not pinned to slot 1 after league creation or after Fill; a pre-Draft reorder (via the existing, unmodified `MemberOrderForm`/`PUT /api/leagues/[leagueId]/members/order`) may move any participant, HUMAN or BOT, to any slot, and `startDraft`'s first-picker computation reads whichever `LeagueMember` occupies slot 1 at Draft-creation time with no special-casing
  - added a commissioner-only, pre-Draft-only **"Manage draft order"** link on `/leagues/[leagueId]/draft`, pointing to `/leagues/[leagueId]` (the existing league-detail page where `MemberOrderForm` lives) — a pure discoverability fix, not a new reorder feature. `MemberOrderForm` was not moved, duplicated, or modified; no new reorder API was added
  - no live-room architecture change was required to render BOT participants correctly — `getCurrentPickerName`/`isYourTurn` (already keyed on `membershipId`/`currentMemberId` since Phase 5.1) and `TeamRosterPanel`'s roster selector (already keyed on `membershipId`) were re-inspected directly during this milestone and confirmed correct with zero changes; the only additions anywhere in the live-room stack were the presentation-only `(BOT)` text marker (draft order list, `DraftBoard` header, `TeamRosterPanel` selector) and threading `participantType` through `TeamRoster` (`team-roster-helpers.ts`) so that marker could be rendered
  - the `(BOT)` member-level marker is unrelated to the existing `AUTO` pick-level badge: `AUTO` remains tied exclusively to `Pick.wasAutopick === true`, and a BOT's own intentional pick still persists `wasAutopick: false` (unchanged since Phase 5.3), so a BOT pick renders with no `AUTO` badge and no BOT-specific pick-level badge. No `PickSource` was introduced
  - BOT pacing (2000ms default sweep interval, at most one BOT pick per league per BOT-sweep phase, no recursive chaining) was carried forward completely unchanged from Phase 5.3 — Milestone 5.4 is what first makes this pacing product-observable (a real solo mock draft can now actually be run against many bot slots), and it was observed acceptable during manual verification, but no pacing change was made or is being proposed
  - player-pool capacity was checked against real dev data, not assumed: ~1,068 rostered players vs. 180 needed for a 12×15 draft (300 for 20×15) — comfortably sufficient; automated-selection eligibility (`Player.nflTeam IS NOT NULL`, unchanged since Phase 5.2) was not broadened
  - Phase 5.4 introduced no separate `/mock-drafts` product area, no bot strategy/difficulty/personality/randomness configuration, no position-aware drafting, no temporary HUMAN-to-CPU takeover, no automatic BOT replacement on a HUMAN join, no bot queue/watchlist, no `PickSource`, no Prisma schema/migration change, no change to `submitPick`/`startDraft`/`processExpiredDraftTurn`/`processBotDraftTurn`/the Socket.IO protocol, and no new shared package/domain abstraction

## Non-negotiable engineering goals

These are the things this project exists to demonstrate. Do not compromise them for velocity.

1. **Server-authoritative state.** The client never decides whose turn it is, whether a pick is legal, or when a timer expires. The client renders what the server tells it.
2. **Concurrent pick safety.** Two clients submitting the same player at the same instant must result in exactly one successful pick. Enforced at the database level, not just in application logic.
3. **Reconnection resilience.** A client that drops and rejoins must resync to correct state. The draft continues regardless.
4. **Horizontal scalability.** The socket layer must work across multiple server instances via Redis pub/sub. An in-memory socket map is not acceptable.
5. **Tested.** Meaningful integration tests, especially around concurrency and turn order. Not just smoke tests.

## Stack

| Layer | Technology |
|---|---|
| Language | TypeScript, `strict: true`, everywhere |
| Frontend | Next.js (App Router), React, Tailwind CSS |
| HTTP API | Next.js route handlers |
| Realtime | Standalone Node server running Socket.IO |
| Database | PostgreSQL, accessed via Prisma |
| Cache / PubSub | Redis via ioredis |
| Auth | Auth.js (NextAuth) |
| Testing | Vitest (unit + integration), Playwright (E2E) |
| Local dev | Docker Compose (Postgres + Redis) |
| CI | GitHub Actions — typecheck, lint, test on every push |
| Deploy | Next.js on Vercel; socket server + Postgres + Redis on Railway or Fly.io |

### Why two processes

Vercel's serverless functions cannot hold persistent WebSocket connections. So the app runs as two deployables that share Postgres and Redis:

- **Next.js app** — pages, auth, league CRUD, everything request/response
- **Socket server** — a long-lived Node process that owns live draft state and pushes events

The project uses a pnpm workspace monorepo with four workspace packages:

- `apps/web` — Next.js application
- `apps/socket-server` — standalone Node realtime server
- `packages/shared` — TypeScript types and utilities shared between both applications
- `packages/database` — Prisma schema, generated client, and shared database access

Keep shared types and database code in their respective packages rather than duplicating them between applications.

### HTTP mutation conventions

League management is request/response CRUD and belongs in the Next.js application, not the socket server.

Current pattern:

- Route Handlers own HTTP/auth/input-validation concerns.
- Feature service functions own database/domain mutations.
- Route Handlers authenticate with `auth()` and derive user identity from the session.
- Request bodies are validated with strict Zod schemas before reaching service functions.
- Client input never controls server-owned identity, authorization, or draft-slot fields.
- Service functions return deliberately shaped DTOs rather than exposing arbitrary Prisma records.
- Multi-row mutations that must preserve an invariant use Prisma transactions.

Current league-creation structure:

- `apps/web/app/api/leagues/route.ts` — authenticated HTTP wrapper
- `apps/web/lib/leagues/schema.ts` — league-creation input validation
- `apps/web/lib/leagues/create-league.ts` — transactional league-creation service
- `apps/web/app/leagues/new/` — minimal manual-verification UI

### League detail read conventions

League detail is read-only and available only to current LeagueMembers.

The page route is:

- `/leagues/[leagueId]`

Read flow:

1. authenticate with `auth()`
2. if unauthenticated, render the existing inline sign-in fallback
3. call `getLeagueDetail(leagueId, session.user.id)`
4. the Prisma query requires both:
   - matching League `id`
   - a membership for the requesting user
5. if no row matches, return `null`
6. the page maps `null` to `notFound()`
7. otherwise render the explicit League Detail DTO

Nonexistent leagues and authenticated non-member access intentionally collapse to the same not-found behavior.

The detail query includes:
- league settings
- owner `{ id, name, image }`
- all members with selected user fields
- members ordered by `draftSlot ASC`

Do not expose User email or Auth.js persistence fields.

### Test database environment convention

`apps/web` integration/concurrency tests must always run against the separate `fantasy_draft_test` PostgreSQL database.

The normal command is:

`pnpm --filter @fdm/web test`

The `apps/web` test script intentionally removes any inherited `DATABASE_URL` before Node loads `.env.test`.

Reason:
- project shells may have the development `DATABASE_URL` exported by direnv
- Node's `--env-file` does not override an environment variable that already exists
- without removing the inherited value first, tests could inherit `fantasy_draft` instead of `fantasy_draft_test`

Current script strategy:

`env -u DATABASE_URL node --env-file=.env.test node_modules/vitest/vitest.mjs run`

`.env.test` is the source of truth for the test `DATABASE_URL`.

`assertUsingTestDatabase()` remains a mandatory defense-in-depth safety guard and must not be removed or weakened. Destructive test helpers refuse to operate unless the resolved database name is exactly `fantasy_draft_test`.

Test files that share the physical test database remain serialized (`fileParallelism: false`); explicit concurrency tests create concurrency within an individual test.

### Shared service/package boundaries

The current monorepo boundary is:

- `packages/shared`
  - persistence-independent domain logic
  - reusable pure functions/types
  - must not depend on Prisma or `@fdm/database`
  - currently owns shared draft-order logic such as `getPickerForPickNumber`

- `packages/database`
  - Prisma client/schema/generated types
  - shared persistence-dependent services used by multiple application transports
  - shared persistence/domain errors required by those services
  - authoritative draft mutation/query services such as `submitPick`, `getDraftState`, `getDraftStateForLeague`, `processExpiredDraftTurn`, `findExpiredActiveDraftLeagueIds`, and (Phase 5.3) `processBotDraftTurn`/`findActiveBotTurnLeagueIds`
  - socket-ticket persistence services
  - test-only database helpers exposed separately through `@fdm/database/test-support`
  - `lockDraftForLeague` and `applyPick` are internal implementation details shared between `submitPick`, `processExpiredDraftTurn`, and (Phase 5.3) `processBotDraftTurn`, not part of the package's public surface — there is exactly one Pick-writing path (`applyPick`), reused by every pick source
  - `selectBestAvailablePlayerId` (Phase 5.2, `packages/database/src/drafts/player-selection.ts`) is the shared BEST_AVAILABLE player-ranking primitive used by both `processExpiredDraftTurn` and (Phase 5.3) `processBotDraftTurn`; unlike `lockDraftForLeague`/`applyPick` it *is* part of the package's public surface, since it is read-only and cannot mutate draft state by itself
  - `processBotDraftTurn`/`findActiveBotTurnLeagueIds` (Phase 5.3, `packages/database/src/drafts/bot-turn.ts`) are the BOT-turn counterpart to `processExpiredDraftTurn`/`findExpiredActiveDraftLeagueIds`; `processBotDraftTurn` is exported publicly (not just its discovery query) because it is itself a safe, high-level orchestration entry point that enforces the same lock/re-validate discipline internally, unlike the raw `lockDraftForLeague`/`applyPick` primitives it wraps

- `apps/web`
  - Next.js HTTP/Auth/UI adapter
  - owns HTTP request validation
  - must call shared persistence services rather than duplicating their transaction logic

- `apps/socket-server`
  - Socket.IO/auth/room transport adapter, plus server-side turn-expiration timer orchestration
  - owns the recurring sweep, whose two phases (Phase 5.3) trigger HUMAN timer-autopick and BOT-turn processing via `@fdm/database`
  - may consume `@fdm/database` and `@fdm/shared`
  - must not import implementation code from `apps/web`
  - must not duplicate authoritative pick transaction logic

Do not move transport-specific Zod/request validation into `packages/database` merely because the underlying service is shared.

Do not create a new shared service/domain workspace package unless the existing boundary becomes demonstrably insufficient.

### League join concurrency

League joining is server-authoritative and concurrency-sensitive.

For `POST /api/leagues/join`:

1. authenticate the request
2. validate the strict `{ inviteCode }` body
3. start a Prisma interactive transaction
4. load and lock the target League row with `SELECT ... FOR UPDATE`
5. reject an existing membership
6. load current LeagueMember draft slots
7. reject if member count has reached `teamCount`
8. compute the lowest free draft slot in `1..teamCount`
9. create the LeagueMember
10. commit

The League row is the serialization point. Concurrent joins to the same league wait on that row lock; joins to different leagues proceed independently.

Do not replace this with an application-level mutex or Redis lock.

Database unique constraints remain defense-in-depth:
- `(leagueId, userId)`
- `(leagueId, draftSlot)`

### Commissioner mutation conventions

Commissioner mutations are owner-only and use `League.ownerId` as the authority source.

Shared authorization/locking flow:

1. start a Prisma interactive transaction
2. lock the target League row with `SELECT ... FOR UPDATE`
3. if the League does not exist, return the league-not-accessible path
4. verify the requester is a LeagueMember
5. if not a member, collapse to the same `404`
6. if a member but `requestingUserId !== League.ownerId`, reject with `403`
7. perform mutation-specific invariant checks
8. write changes
9. commit

The League row is the serialization point for:
- joins
- league settings updates
- draft-slot reorders

This prevents join/settings/reorder races from observing stale membership or capacity state.

### Draft start conventions

Endpoint:

- `POST /api/leagues/[leagueId]/draft`

Draft start is a commissioner-only HTTP state transition, not a realtime socket event.

Transaction flow:

1. start a Prisma interactive transaction
2. lock and authorize the League using the existing commissioner authorization path
3. reject if a Draft already exists
4. load current League membership
5. require `memberCount === teamCount`
6. compute the first picker using `getPickerForPickNumber`
7. resolve the LeagueMember occupying that draft slot
8. compute `turnDeadline` from server time plus `timerSeconds`
9. create the Draft directly as `ACTIVE`
10. return an explicit DTO
11. commit

Initial Draft state:

- `status = ACTIVE`
- `currentPickNumber = 1`
- `currentMemberId = first picker's own LeagueMember.id` (Phase 5.1: renamed from `currentUserId`; identifies the participant, HUMAN or BOT, not a User)
- `turnDeadline = server time + timerSeconds`

`Draft.leagueId @unique` is the database-level duplicate-draft backstop.

The League row remains the shared serialization point for:
- joining
- commissioner settings
- draft-slot reorder
- draft start

Once a Draft exists:
- league settings mutation is rejected with `409`
- draft-slot reorder is rejected with `409`

No Draft settings snapshot exists in the current model.

### Pick submission conventions

Endpoint:

- `POST /api/leagues/[leagueId]/draft/picks`

Request:

`{ "playerId": "<Player.id>" }`

All turn ownership and draft-state fields are server-owned.

The client does not submit:
- `userId`
- `draftId`
- `pickNumber`
- `draftSlot`
- `wasAutopick`
- `currentMemberId`
- `turnDeadline`

Manual pick submission flow (updated by Phase 5.1 — see "Settled decisions" and Milestone 5.1's completed-work notes for the identity-migration rationale):

1. verify the requester is a current `LeagueMember`, resolving that human's own membership by `(leagueId, userId)` — this step stays userId-keyed on purpose: a human always authenticates with a real `User.id`
2. lock the League's Draft row with `SELECT ... FOR UPDATE`
3. require an existing Draft
4. require `Draft.status = ACTIVE`
5. require the requester's own `LeagueMember.id === Draft.currentMemberId` (not a `userId` comparison — turn ownership is participant identity, so this is equally correct if the current picker is a BOT: it simply never matches a human requester's membership id)
6. load immutable League draft configuration
7. require the selected Player to exist
8. reject a Player already drafted in this Draft
9. create the Pick at `Draft.currentPickNumber` with `leagueMemberId` = the requester's own `LeagueMember.id` and `wasAutopick = false`
10. determine whether the Pick is final
11. for a non-final Pick:
    - increment `currentPickNumber`
    - compute the next `draftSlot` with `getPickerForPickNumber`
    - resolve that slot directly to its `LeagueMember.id` (no `.userId` hop needed — this got simpler in 5.1, not just renamed)
    - update `currentMemberId`
    - set a new server-owned `turnDeadline`
12. for the final Pick:
    - set `status = COMPLETE`
    - retain `currentPickNumber = totalPicks`
    - set `currentMemberId = null`
    - set `turnDeadline = null`
13. commit and return an explicit DTO

Bots never call this authenticated-human entry point (step 1 requires a real `userId`); a future bot-turn orchestrator (Phase 5.3) will call the same underlying `applyPick` directly with the bot's own `LeagueMember.id`, bypassing steps 1 and 5.

The Draft row is the serialization point for turn consumption.

A successful manual pick must atomically:
- create exactly one Pick
- consume exactly one current turn
- advance Draft state exactly once

A rejected pick must leave both Pick and Draft state unchanged.

`totalPicks = teamCount * rosterSize`.

For every successful non-final manual Pick:

`turnDeadline = server time + League.timerSeconds`

Turn progression must use the shared `getPickerForPickNumber`; do not duplicate SNAKE/LINEAR arithmetic in mutation services.

### Authoritative draft-state query and DTO ownership

Persistence-independent draft-state DTO types are owned by `packages/shared`.

These include:
- `DraftStateResult`
- `DraftStateMember`
- `DraftStatePick`
- related plain string-literal status/configuration types

`packages/shared` remains Prisma-free.

The actual database queries, Prisma selects, authorization checks, and mapping logic remain owned by `packages/database`.

Public query services:

- `getDraftState(leagueId, requestingUserId)`
  - membership-checked
  - returns `null` for nonexistent/inaccessible League
  - intended for authenticated transport adapters

- `getDraftStateForLeague(leagueId)`
  - no membership check
  - server-internal use only
  - callers must establish authorization before using it

Both return the shared persistence-independent `DraftStateResult` shape.

Do not duplicate the draft-state DTO separately across web, database, and socket packages.

Do not expose raw Prisma rows or Auth.js persistence fields through HTTP or realtime state payloads.

As of Phase 5.1: `DraftStateMember` additionally carries `participantType: "HUMAN" | "BOT"` and a nullable `userId`; `name`/`image` are already normalized (`HUMAN → user.name/user.image`, `BOT → displayName/null`) by the time they reach this DTO, so consumers never branch on participant type themselves. `Draft.currentUserId` was renamed to `currentMemberId` and `DraftStatePick.userId` to `leagueMemberId` — both now identify a `LeagueMember`, not a `User` — see "Settled decisions" for the full rationale.

### Socket.IO draft protocol conventions

Socket authentication:
- browser first obtains a SocketTicket from authenticated `POST /api/socket/ticket`
- ticket is supplied through Socket.IO handshake auth
- socket server atomically consumes the ticket
- successful consumption establishes `socket.data.userId`
- client event payloads never supply authoritative identity
- invalid/expired/consumed tickets are rejected generically

Current client-to-server events:
- `draft:join`
- `draft:pick`

Current server-to-client events:
- `draft:state`

Socket request failures are returned through acknowledgement callbacks with stable error codes.

There is no standalone `pick:rejected` event.

League rooms are keyed as:

`league:${leagueId}`

`draft:join`:
- strictly validates payload
- checks League membership through authoritative database state lookup
- joins the League room only after authorization succeeds
- returns authoritative state through its acknowledgement

`draft:pick`:
- strictly validates payload
- requires the socket to have joined the League room
- derives user identity exclusively from authenticated socket data
- calls shared `submitPick`
- does not duplicate transaction or turn-validation logic
- rejected picks do not broadcast state
- accepted picks re-read authoritative state and broadcast one full `draft:state` snapshot to the room

Draft completion is represented by the normal authoritative `draft:state` payload:
- `status === "COMPLETE"`
- `currentMemberId === null` (Phase 5.1: renamed from `currentUserId`)
- `turnDeadline === null`

Do not add a redundant `draft:complete` event unless a future requirement demonstrates a concrete need.

Socket.IO room membership and broadcasts are realtime delivery mechanisms only. They are not correctness boundaries. Postgres transactions remain authoritative.

### Realtime reconnect behavior

SocketTickets are single-use, so reconnecting clients must mint a fresh ticket.

Current reconnect/resync flow:

1. mint a fresh SocketTicket
2. reconnect to Socket.IO
3. authenticate by consuming the fresh ticket
4. emit `draft:join`
5. receive current authoritative state
6. replace local draft state with that snapshot

No event replay or missed-event log exists yet.

Authoritative state resync, rather than replaying every missed realtime event, is the current recovery primitive.

More sophisticated reconnect/recovery behavior may be added later only if required.

#### Pick-success resync (Milestone 4.6)

A second, narrower use of the same `draft:join` resync primitive: on a successful `draft:pick` acknowledgement, the submitting client immediately emits `draft:join` again rather than only waiting on the room-wide `draft:state` broadcast. This closes a residual edge from Milestone 4.4 — the server's order is commit → `{ok:true}` ack → `broadcastDraftState`, and if the broadcast step specifically failed or was lost while the socket stayed connected, the client had no further signal to clear its pending-pick state.

- the resync is triggered client-side only, off the existing successful ack; no server/protocol change was made, and `DraftPickAck` was not widened
- the resync's response is applied through the same `applyAuthoritativeState` function every other authoritative snapshot goes through
- the room-wide `draft:state` broadcast is unchanged and still what every other connected client relies on; if it also reaches the submitting client, applying it again is safe — replacing `DraftStateResult` wholesale is always safe for any valid authoritative snapshot, whether or not it turns out to be newer than the resync's own snapshot
- if the resync's own `draft:join` ack comes back rejected, that does not mean the pick failed (the original `draft:pick` ack already confirmed it succeeded) — pending/in-flight client state is cleared and the user sees refresh guidance, never pick-failure wording
- accepted residual: if the resync's own ack is itself lost while the socket still appears connected, pending state remains until either the room broadcast arrives or Socket.IO's heartbeat forces a real `disconnect` (which already unconditionally clears pending state). No additional timeout was added for this case — it is accepted as a low-risk residual, not treated as an exactly-once guarantee.

### Turn-expiration and autopick conventions

`apps/socket-server` owns a single recurring, self-rescheduling sweep (`startTurnSweep`/`stopTurnSweep`/`runSweepOnce`, default interval 2000ms via `DEFAULT_SWEEP_INTERVAL_MS`), started from `index.ts`'s real process lifecycle and stopped on graceful shutdown. It is not started inside `createSocketServer()`, so tests that build a server via `createSocketServer()`/`startTestServer()` never silently inherit a live background DB-polling interval. As of Phase 5.3, this one sweep has **two sequential phases per tick** — HUMAN timer-expiry, then BOT-turn processing — not two separate timers:

```ts
export async function runSweepOnce(io: DraftServer): Promise<void> {
  await runHumanExpirySweep(io);
  await runBotTurnSweep(io);
}
```

There is still exactly one `startTurnSweep`/`stopTurnSweep`, one self-rescheduling `setTimeout`, one configured interval. No second bot-specific timer/lifecycle was introduced, and there is no immediate/recursive bot-chaining off a successful pick — both phases are strictly polling-driven. The sweep remains non-overlapping exactly as before 5.3 (the next tick is only scheduled after the current `runSweepOnce()` promise settles).

**HUMAN timer-expiry phase (`runHumanExpirySweep`)** — the pre-5.3 sweep body, unchanged in behavior except for one added discovery filter:

1. `findExpiredActiveDraftLeagueIds()` — a plain, unlocked Postgres read for `Draft.status = ACTIVE AND turnDeadline <= now AND currentMember.participantType = HUMAN`. The `participantType = HUMAN` clause is new in Phase 5.3 and is a **discovery-time efficiency filter only** — it narrows candidates so the human path doesn't waste a lock+read cycle on drafts already known (at discovery time) to be BOT-current.
2. for each candidate League, `processExpiredDraftTurn(leagueId)` locks the Draft row (`lockDraftForLeague`, the same lock `submitPick` uses), re-reads the current `LeagueMember`, and — this is the **authoritative** check, not the discovery filter above — returns `{ outcome: "skipped", reason: "CURRENT_PARTICIPANT_IS_BOT" }` if `participantType !== HUMAN`, before ever evaluating `turnDeadline`. Discovery filters early; the locked, post-lock re-read is what's actually trusted, because participant identity can change between the unlocked discovery read and the transaction acquiring the lock (e.g. a same-tick BOT pick already advanced this exact draft).
3. otherwise re-validates expiry *inside* the lock; a candidate that went stale between discovery and lock acquisition (already picked, no longer `ACTIVE`, deadline no longer past) returns a `"skipped"` outcome — a routine no-op, not an error
4. a genuinely expired HUMAN turn selects the next Pick via `selectBestAvailablePlayerId` and applies it through the same internal `applyPick(...)` used by `submitPick`, with `wasAutopick: true`
5. only a `"picked"` outcome triggers `broadcastDraftState(...)` — one authoritative `draft:state` snapshot to `league:${leagueId}`

**BOT-turn phase (`runBotTurnSweep`, Phase 5.3)** — structurally parallel to the human phase, but a fully separate discovery query and a fully separate service, not one function branching on participant type:

1. `findActiveBotTurnLeagueIds()` (`packages/database/src/drafts/bot-turn.ts`) — a plain, unlocked read for `Draft.status = ACTIVE AND currentMember.participantType = BOT`. **Deliberately no `turnDeadline` condition at all** — a BOT's turn is never gated on any deadline elapsing; `turnDeadline` is computed identically for BOT and HUMAN newly-current participants (see below), but only carries eligibility meaning for HUMAN turns. No new database index was added for this query, matching the same small-table scale assumption `findExpiredActiveDraftLeagueIds` already makes.
2. for each candidate League, `processBotDraftTurn(leagueId)` locks the Draft row (the identical `lockDraftForLeague` the human phase and `submitPick` use), re-reads the current `LeagueMember`, and returns `{ outcome: "skipped", reason: "NOT_BOT_TURN" }` if `participantType !== BOT` — the authoritative check, exactly mirroring the human phase's guard
3. `{ outcome: "skipped", reason: "NO_DRAFT" }` / `"NOT_ACTIVE"` cover the same no-Draft/non-ACTIVE cases the human phase has
4. a genuine BOT turn reads League config, then calls `selectBestAvailablePlayerId` inside the same transaction, then applies the result through the identical `applyPick(...)` used by every other pick source, with `leagueMemberId` = the BOT's own `LeagueMember.id` and `wasAutopick: false`
5. only a `"picked"` outcome triggers `broadcastDraftState(...)`, calling the same unmodified helper the human phase and `draft:pick` handler already share

Because every pick source — manual, human-autopick, and BOT — locks and re-validates against the identical Draft row, a manual-pick-vs-autopick race, a manual-pick-vs-BOT race (structurally impossible anyway; see below), a duplicate-sweep-vs-sweep race, and a duplicate-BOT-call-vs-BOT-call race all resolve to exactly one turn consumer — the same guarantee Milestone 3.2 established for concurrent manual submissions, now proven to extend to BOT turns by a dedicated concurrency test.

**Deadline routing rule (no schema change):** `applyPick`'s "advance to next picker" branch is completely unmodified by Phase 5.3 — it writes `turnDeadline = now + timerSeconds` identically regardless of whether the newly-current participant is HUMAN or BOT. `participantType` alone is the routing signal:
- **HUMAN current:** `turnDeadline` controls timer-expiry eligibility, exactly as before Phase 5.3.
- **BOT current:** `participantType === BOT` alone controls BOT-sweep eligibility; the BOT's stored deadline carries no wait requirement and is never inspected by the BOT phase.

Verified transitions:
- **HUMAN → BOT:** the human phase's `applyPick` call writes a normal deadline for the new BOT current participant. Because `runBotTurnSweep`'s own discovery query runs (and sees committed state) only *after* `runHumanExpirySweep` fully completes within the same `runSweepOnce()` call, a HUMAN's turn expiring directly into a BOT **can result in both Picks within one overall sweep tick** — confirmed by a dedicated test (2-team LINEAR league, slot 1 HUMAN expired, slot 2 BOT; one `runSweepOnce()` call applies both picks, landing on `currentPickNumber = 3` back on the human).
- **BOT → BOT:** exactly one BOT Pick is applied per league during a single BOT-phase pass — no recursion, no inner while loop. The next BOT in a chain is discovered and processed on the *next* sweep tick, not the same one. A consecutive BOT→BOT→BOT→... chain therefore progresses one pick per league per sweep interval (default 2000ms) — an intentional correctness-first starting point, not an oversight; a long all-BOT run (e.g. a future mock draft with many bot slots) may take proportionally longer to fully resolve, which may be worth revisiting for pacing later, but any such change must remain row-lock-based rather than introducing a new correctness mechanism.
- **BOT → HUMAN:** `applyPick` writes a fresh HUMAN deadline and ordinary timer-expiry behavior resumes completely unmodified.

**Player selection (`selectBestAvailablePlayerId`, extracted in Phase 5.2, unchanged by 5.3):** lives in `packages/database/src/drafts/player-selection.ts`, exported through `@fdm/database`'s public entry point. Signature: `selectBestAvailablePlayerId(tx: Prisma.TransactionClient, { draftId, scoringFormat }): Promise<string | null>`. Read-only — never writes a Pick, never touches `Draft`, owns no part of the transactional correctness boundary itself. No `BotDraftStrategy` enum or strategy-dispatch layer exists — "BEST_AVAILABLE" is this one function's behavior, not a selectable value, until a second, genuinely different policy exists (5.5+).

Scoped to Players not yet drafted in the supplied `draftId` (a Player drafted only in a *different* Draft remains eligible — draft pools are per-Draft, not global) and to `Player.nflTeam IS NOT NULL` (rostered players only):
- tier 1: lowest `PlayerAdp.adp` for the League's `scoringFormat`, tiebroken by `player.searchRank ASC NULLS LAST`, then `player.id ASC`
- tier 2 (fallback when no undrafted rostered Player has an ADP row for that format): lowest `Player.searchRank`, nulls last, `id asc` as a final deterministic tiebreak
- no roster-position awareness yet
- returns `null` when no eligible undrafted rostered Player exists in either tier; the selector itself never throws — each caller defines its own exhaustion semantics: `processExpiredDraftTurn` converts `null` into `AutopickExhaustedError`; `processBotDraftTurn` converts it into the distinct `BotPickExhaustedError` (see below)

**`BotPickExhaustedError` (Phase 5.3):** thrown by `processBotDraftTurn` when `selectBestAvailablePlayerId` returns `null` for a BOT's turn — the same underlying condition `AutopickExhaustedError` represents (the seeded rostered Player pool is smaller than `teamCount * rosterSize`), kept as a distinct class so BOT-pool exhaustion can be logged/handled separately from human-autopick-pool exhaustion if that distinction is ever useful. Thrown inside the transaction, so it rolls back completely: no Pick written, `currentPickNumber`/`currentMemberId` unchanged, Draft stays `ACTIVE` with the same BOT current participant. `apps/socket-server`'s BOT-phase catch block logs it and continues to the next league in the batch, exactly mirroring `AutopickExhaustedError`'s existing handling; the affected Draft is retried identically on every subsequent tick until the underlying seed/roster-size mismatch is corrected. No product-facing recovery UI exists.

**BOT pick attribution:** `Pick.leagueMemberId` = the BOT's own `LeagueMember.id`; `Pick.wasAutopick = false`. `wasAutopick` keeps its pre-5.3 meaning exactly — `true` only for a human's missed-deadline timer autopick, never for a BOT's own intentional pick. A Pick's origin (manual / human-autopick / BOT) remains fully derivable from `Pick.leagueMemberId` joined against `LeagueMember.participantType`, plus `Pick.wasAutopick`, with zero new columns — no `PickSource` field and no BOT-specific UI badge exist yet.

Restart recovery is a byproduct of polling live Postgres state rather than a separate feature, for both phases identically: a freshly started socket-server process discovers exactly the same expired/future HUMAN deadlines *and* the same BOT-current drafts a long-running process would, with no in-memory timer/state to reconstruct, and with zero client/browser/socket presence required.

**Concurrency:** two concurrent `processBotDraftTurn(leagueId)` calls for the same BOT turn resolve exactly like two concurrent `processExpiredDraftTurn`/`submitPick` calls already do — whichever transaction locks the Draft row first applies the Pick; the second locks afterward, re-reads the now-advanced state, and returns a normal skip (`NOT_BOT_TURN`). PostgreSQL row locking remains the sole mutation-correctness boundary for BOT turns, exactly as for every other pick source; no Redis or distributed lock was added, and none is required for this invariant even if duplicate calls were to originate from more than one process in a future multi-instance deployment — only operational scheduling, not this transaction guarantee, would change with future scaling infrastructure.

**HUMAN submission while a BOT is current:** verified (by direct test, not just by inspection) that a human can never submit a pick "as" a BOT — a human's own membership always resolves via `(leagueId, userId)` to their own, non-BOT `LeagueMember` row, which structurally cannot equal `draft.currentMemberId` when a BOT is on the clock. `submitPick`'s existing, completely unmodified `NotOnTheClockError` check already rejects this correctly. No new BOT-authorization guard was added or is needed.

Public correctness services: `submitPick` (manual), `processExpiredDraftTurn` (HUMAN timer-expiry), and `processBotDraftTurn` (BOT turns, Phase 5.3). `lockDraftForLeague` and `applyPick` are internal `@fdm/database` implementation details, not part of the public surface — there is exactly one Pick-writing path (`applyPick`) shared by all three services. `selectBestAvailablePlayerId` and `processBotDraftTurn`/`findActiveBotTurnLeagueIds` are the exceptions to the internal-only pattern: they are exported publicly because they are either read-only or (in `processBotDraftTurn`'s case) a safe high-level orchestration entry point that itself enforces the same locked-transaction discipline — none of them can corrupt draft state on their own, and exporting them is what lets `apps/socket-server` (which can only reach `@fdm/database` through its public entry point) call them without a package-boundary change.

#### Pick submission status conventions

- unauthenticated → `401`
- malformed/unknown request fields → `400`
- authenticated non-member / inaccessible League → `404`
- no Draft for the accessible League → `404`
- unknown Player → `404`
- Draft not `ACTIVE` → `409`
- authenticated member not currently on the clock → `409`
- Player already drafted in this Draft → `409`
- success → `201`

Impossible persisted-state failures, such as being unable to resolve the computed next picker, are internal invariant failures rather than normal client conflicts.

### Draft turn-order conventions

Pure shared function:

`getPickerForPickNumber(pickNumber, numTeams, draftType)`

Returns the 1-indexed `draftSlot` that owns a given overall pick number.

Inputs:
- `pickNumber` must be a positive integer
- `numTeams` must be a positive integer
- `draftType` must be `SNAKE` or `LINEAR`

LINEAR:
- each round runs slots `1..N`

SNAKE:
- odd-numbered human rounds run `1..N`
- even-numbered human rounds run `N..1`

Example for 12 teams:
- pick 12 → slot 12
- pick 13 → slot 12
- pick 24 → slot 1
- pick 25 → slot 1

This function lives in `packages/shared` because draft start, manual pick submission (HTTP and socket), and server-owned autopick all require identical turn-order behavior.

It must remain persistence-independent.

### Phase 2 authorization matrix

| Actor | Create | Join | View league | Update settings | Reorder members |
| --- | --- | --- | --- | --- | --- |
| Unauthenticated | 401 | 401 | sign-in fallback | 401 | 401 |
| Authenticated non-member | may create own league | succeeds with valid code/capacity | 404/notFound | 404 | 404 |
| Authenticated non-owner member | may create own league | 409 if already member | 200 | 403 | 403 |
| Authenticated owner | 201 for new league | 409 for own existing league | 200 + commissioner controls | 200 | 200 |

Authorization is enforced server-side. UI visibility of commissioner controls is only a UX layer and is not considered an authorization boundary.

#### Commissioner settings

Endpoint:

- `PATCH /api/leagues/[leagueId]`

Allowed fields:
- `name`
- `rosterSize`
- `teamCount`
- `timerSeconds`
- `scoringFormat`
- `draftType`

PATCH schemas:
- are strict
- use optional fields
- do not apply creation-time defaults
- reject empty bodies

`teamCount` decreases must preserve:
- current membership count
- highest occupied draft slot

Settings changes do not implicitly reorder members.

#### Draft-slot reorder

Endpoint:

- `PUT /api/leagues/[leagueId]/members/order`

Request:

```json
{
  "memberIds": ["membershipA", "membershipB", "membershipC"]
}
```

### Authoritative draft-state query

Shared draft-state reads are owned by `packages/database`.

Public query services:

- `getDraftState(leagueId, requestingUserId)`
  - membership-checked
  - returns `null` for nonexistent/inaccessible League
  - intended for authenticated transport adapters

- `getDraftStateForLeague(leagueId)`
  - no membership check
  - server-internal use only
  - callers are responsible for establishing authorization before using it

The returned `DraftStateResult` is an explicit transport-independent DTO rather than a generated Prisma model.

It contains:
- League configuration required by draft clients
- LeagueMembers ordered by `draftSlot`
- current Draft state, or `null` before draft start
- Picks ordered by `pickNumber`
- safe Player display information for persisted Picks

Do not expose raw Prisma rows or Auth.js persistence fields through realtime state payloads.

### Commissioner mutation status conventions

- unauthenticated → `401`
- nonexistent league → `404`
- authenticated non-member → `404`
- authenticated member but non-owner → `403`
- malformed/invalid request body → `400`
- `teamCount` conflicts with current membership/slot state → `409`
- reorder membership set does not exactly match current league membership → `409`
- unexpected draft-slot reorder conflict → `409`
- unexpected internal/database errors → `500`

### Invite-code conventions

- Length: 8
- Alphabet: `ABCDEFGHJKMNPQRSTUVWXYZ23456789`
- Stored uppercase
- User input is trimmed and uppercased before validation/lookup
- Generation uses Node `crypto.randomInt`
- `League.inviteCode` is database-unique
- League creation retries invite-code collisions up to 5 times
- Existing rows are backfilled through migrations using the same alphabet and explicit collision checks
- No invite-code rotation in current scope

### Integration testing conventions

- `apps/web` has its own Vitest configuration.
- Database integration tests run against real PostgreSQL using the dedicated `fantasy_draft_test` database.
- Never run destructive test cleanup against the development `fantasy_draft` database.
- Test helpers must verify the active database name before destructive cleanup and fail loudly if it is not `fantasy_draft_test`.
- The test database uses the same checked-in Prisma migrations as development; do not maintain a separate test schema.
- The test `DATABASE_URL` must be present in `process.env` before `@fdm/database` initializes its Prisma singleton.
- Current DB-backed web test files run serially because they share one physical test database.
- Do not introduce transaction/dependency-injection machinery solely to manufacture artificial rollback tests.
- **Cross-package dependency-build convention (discovered/fixed during Phase 5.3's verification):** `apps/socket-server` and `apps/web` both resolve `@fdm/database` (and `@fdm/shared`) through the pnpm workspace symlink, whose `package.json` `"exports"` field points at built `dist` output — neither app ever consumes that package's `src` directly. When a consuming package's tests depend on code that changed in a workspace dependency, rebuild that dependency (or the whole workspace) *before* trusting the consumer's test result; otherwise the tests may silently run against stale `dist` output rather than current source. For a milestone closeout involving cross-package changes, prefer this order: fresh dependency build → consumer package tests → workspace typecheck/build — e.g. `pnpm -r run build` (which builds `packages/shared`/`packages/database` before the apps that depend on them) followed by each affected package's `test` script. This is a known tooling characteristic of the current monorepo setup, not something Phase 5.3 changed or is expected to redesign.

### Socket authentication conventions

Realtime socket authentication uses short-lived, single-use tickets rather than trusting a client-supplied `userId` or exposing the Auth.js session token to the socket server.

Ticket flow:

1. authenticated browser calls `POST /api/socket/ticket`
2. Next.js derives `userId` from the existing Auth.js session
3. server creates a persisted `SocketTicket`
4. ticket contains a random UUID token and expires 15 seconds after creation
5. browser supplies that token during the Socket.IO connection handshake
6. socket server atomically consumes the ticket through `consumeSocketTicket`
7. successful consumption resolves the authoritative `userId`
8. expired, unknown, or already-consumed tickets are rejected identically

Socket tickets are:
- short-lived
- single-use
- persisted in Postgres
- server-minted
- never a source of authorization beyond establishing authenticated user identity

League/draft authorization must still be checked separately after socket authentication.

The client must never be allowed to claim an arbitrary `userId`.

Expired ticket rows currently have no background cleanup process. Expiration is enforced at consumption time; cleanup may be added later if operationally necessary.

### Known maintenance issue — Prisma P2002 constraint metadata

Under the current Prisma 7 + `@prisma/adapter-pg` stack, observed P2002 errors do not reliably populate `error.meta.target`.

The adapter currently exposes constraint columns through:

`error.meta.driverAdapterError.cause.constraint.fields`

Milestone 3.2's `submit-pick.ts` handles both the conventional `meta.target` shape and the observed adapter-pg shape for constraint-specific error mapping.

Pre-existing Phase 2 P2002 handlers in:
- `apps/web/lib/leagues/create-league.ts`
- `apps/web/lib/leagues/join-league.ts`
- `apps/web/lib/leagues/reorder-league-members.ts`

still use the older constraint-target parsing assumption and were intentionally not modified during Milestone 3.2.

Fix these in a separate maintenance change rather than silently folding the cleanup into unrelated Phase 3 work.

### Known issue — League deletion blocked by Pick → LeagueMember FK ordering

Discovered and verified during Milestone 5.1's final verification pass, deliberately not fixed there per that pass's own scope (report, don't redesign).

The current FK topology:

- `LeagueMember.league` → `League`, `onDelete: Cascade` (unchanged, pre-5.1)
- `Draft.league` → `League`, `onDelete: Cascade` (unchanged, pre-5.1)
- `Pick.draft` → `Draft`, `onDelete: Cascade` (unchanged, pre-5.1)
- `Pick.leagueMember` → `LeagueMember`, `onDelete: Restrict` (new in 5.1 — see "Settled decisions")

Deleting a League with Draft/Pick history fails. Verified directly against `fantasy_draft_test` by seeding a League/LeagueMember/Draft/Pick and running `DELETE FROM "League"`:

```
ERROR:  update or delete on table "LeagueMember" violates foreign key constraint "Pick_leagueMemberId_fkey" on table "Pick"
DETAIL:  Key (id)=(...) is still referenced from table "Pick".
```

PostgreSQL processes the `League → LeagueMember` cascade before the `League → Draft → Pick` cascade has had a chance to remove the Pick row that still references that LeagueMember, so the `Restrict` on `Pick.leagueMemberId` trips first and the whole `DELETE` rolls back.

Verified properties of the failure:
- transactional and clean — all four rows (League, LeagueMember, Draft, Pick) were confirmed still present afterward; nothing was partially removed
- reproducible, not a one-off

Why this isn't a current blocker:
- no delete-League feature exists anywhere in the product today (no DELETE route, no UI)
- the `Restrict` on `Pick.leagueMemberId` is deliberate (see "Settled decisions") and is not being loosened just to make this pass — it's exactly what protects historical pick attribution from a User-cascade-driven LeagueMember deletion

This **must** be resolved before any future League-deletion feature ships — e.g. by deleting Draft/Pick rows explicitly (in FK-safe order) inside the same application transaction before the League row is deleted, rather than relying on DB-level cascade ordering across two independent cascade paths. Do not attempt to fix this by loosening `Pick.leagueMemberId`'s `Restrict` back to `Cascade`; that would silently defeat the historical-attribution guarantee 5.1 exists to provide.

### Pre-draft page and live draft-room conventions

Pre-draft planning/viewing and live drafting are two distinct routes.

`/leagues/[leagueId]/draft` — stable pre-draft / draft-summary page:
- never opens a Socket.IO connection
- before a Draft exists, renders: draft settings (draft type, round count, timer, scoring format), draft order (`state.members`/`LeagueMember` in `draftSlot` order, with a `(BOT)` marker per Milestone 5.4), the full empty draft board, a read-only Available Players panel, and — for the commissioner only — Fill/Remove Bots controls (Milestone 5.4, see "Bot fill/remove conventions"), a **Manage draft order** link into `/leagues/[leagueId]` (Milestone 5.4), and the Start Draft control
- once `ACTIVE`, renders a compact "Draft in progress" summary plus a **Join Draft Room** link into `/draft/room`
- once `COMPLETE`, renders a compact "Draft complete" summary plus a **View Draft Room** link into `/draft/room`
- the commissioner-only Fill/Remove Bots controls and the **Manage draft order** link are rendered only in the pre-Draft body above — never in the ACTIVE/COMPLETE summary branches, which return before that code is reached, and never for a non-commissioner
- data source is `getLeagueDetail(leagueId, requestingUserId)` alone — no `getDraftState` call is needed, since the DTO already carries league settings, `ownerId`, ordered members, and (as of Milestone 4.5) `draft.status`

`/leagues/[leagueId]/draft/room` — live draft room:
- if no Draft exists yet, server-side `redirect()`s back to `/leagues/[leagueId]/draft` rather than rendering its own "no Draft" state
- otherwise renders the existing `DraftRoomClient` unchanged: SocketTicket mint → Socket.IO connect → `draft:join` → authoritative `DraftStateResult` → `draft:pick` submissions → `draft:state` broadcasts → reconnect/resync, all exactly as established in 3.3b/4.2/4.4
- data source is `getDraftState(leagueId, requestingUserId)`, unchanged from before this milestone

Commissioner detection on the pre-draft page:
- `getLeagueDetail(...).league.ownerId === currentUserId`
- never inferred from `draftSlot` or from `DraftStateResult`
- presentation-only — `startDraft`'s own server-side owner authorization (via `authorizeLeagueOwner`) remains the actual authoritative check regardless of what the pre-draft page renders

"Start Draft" vs "Join Draft Room":
- Start Draft is the existing commissioner-only `POST /api/leagues/[leagueId]/draft` mutation; unchanged authorization/transaction behavior
- Join Draft Room is navigation only — the user is already a `LeagueMember`; there is no second "draft-room membership" concept, table, or model
- a successful Start Draft navigates the commissioner directly into `/draft/room`; other members see the Join Draft Room link appear on `/draft` the next time they load/refresh it (the pre-draft page has no realtime subscription of its own — this is an accepted limitation, not a defect, since it can only under-inform, never mislead)

Shared Draft Board:
- one pure derivation, `deriveDraftBoard(state: DraftStateResult)`, reused unmodified by both routes
- rows = `state.league.rosterSize`; columns = the fixed `draftSlot` order (never reversed); cell-slot mapping reuses the existing shared `getPickerForPickNumber` — no second snake/linear implementation
- completed cells come only from authoritative `state.picks`; the current-pick cell highlights only while `status === "ACTIVE"`, derived from `currentPickNumber`
- cell player metadata (`playerName`/`playerPosition`/`playerNflTeam`, `wasAutopick`) comes directly from `DraftStatePick` — never joined against the separate, web-only, rostered-only (4.3) `AvailablePlayer` discovery pool
- the pre-draft page's empty board is the same function fed a locally-constructed `DraftStateResult`-shaped value (`draft: null, picks: []`) built from the already-fetched `getLeagueDetail` fields — no second query, no second geometry implementation

Shared rosters / My Team:
- one pure derivation, `deriveTeamRosters(state: DraftStateResult)`, groups authoritative `state.picks` by member/user in `state.members`'s existing `draftSlot` order, each roster's own picks staying in their existing `pickNumber` order
- the live room's roster panel defaults to the authenticated user's own roster with a simple selector to inspect any other manager — one panel, not every team stacked vertically
- no starter/bench concept and no roster-position enforcement

Available Players reuse:
- `AvailablePlayersPanel`'s `onDraft`, `canDraft`, and `pendingPlayerId` props are optional
- omitting `onDraft` puts the panel into read-only mode: search/filter/ADP Rank all still work, but no Action column is rendered and no pick can be submitted
- the pre-draft page uses read-only mode; the live room continues supplying all three props for the unchanged Milestone 4.4 actionable behavior (Draft buttons, pending state, drafted-player removal from authoritative `state.picks`)
- there is exactly one player-list implementation, not two

### Draft length / rosterSize product conventions

`rosterSize` (round count) remains the domain/database/engine representation — it is a plain, unconstrained `Int` column, and every engine consumer (`submitPick`'s `totalPicks = teamCount * rosterSize`, autopick, and the Milestone 4.5 `deriveDraftBoard`) reads it dynamically off the League/`DraftStateResult`. No engine-level literal `15` exists anywhere.

Current product decision (Milestone 4.5): newly created leagues are fixed to a 15-round draft, and round count is not user-configurable through the product today.

- `PRODUCT_ROSTER_SIZE = 15`, defined in `apps/web/lib/leagues/schema.ts`
- the public `createLeagueInputSchema` has no `rosterSize` field — sending one is a `400` (unrecognized field), not a range-validation failure
- `POST /api/leagues` always supplies `rosterSize: PRODUCT_ROSTER_SIZE` to `createLeague()`
- the public `updateLeagueSettingsInputSchema` has no `rosterSize` field either — there is no product/API path to change round count after creation
- `create-league-form.tsx` and `league-settings-form.tsx` expose no roster-size input
- the service-level `createLeague(input: CreateLeagueInput, ownerId)` still accepts an explicit `rosterSize` — `CreateLeagueInput` (`apps/web/lib/leagues/create-league.ts`) is `CreateLeagueApiInput & { rosterSize: number }`, deliberately distinct from the public schema-inferred `CreateLeagueApiInput`. Internal tests/fixtures needing a non-15 `rosterSize` (e.g. for faster concurrency tests) call `createLeague()` directly, unaffected by the public boundary
- no DB migration was required or performed; historical League rows with non-15 `rosterSize` (e.g. `16`) continue to work unchanged, rendering their own correct board/round geometry and engine behavior
- this design keeps the architecture capable of reintroducing product-level configurability later without any engine change — only the input boundary (schema + forms) would need to change again

### Bot fill/remove conventions

Phase 5.4 conventions. This is the first product-accessible way to create a BOT `LeagueMember` — see "Settled decisions" for the full rationale behind each choice below.

Endpoints:

- `POST /api/leagues/[leagueId]/bots/fill`
- `DELETE /api/leagues/[leagueId]/bots`

Neither endpoint reads a request body. Every field either mutation needs — `participantType`, `displayName`, `draftSlot`, and how many bots to create/remove — is entirely server-derived from locked, authoritative membership state. There is no legitimate client-controlled BOT payload, so there is no schema to validate a body against.

Fill flow (`fillOpenLeagueSlotsWithBots`, `apps/web/lib/leagues/fill-bots.ts`):

1. `authorizeLeagueOwner` — locks the League row `FOR UPDATE`, requires the requester to be the commissioner (same shared primitive every other commissioner mutation uses)
2. `getDraftForLeague` — reject with `DraftAlreadyStartedError` if a Draft already exists
3. read current `LeagueMember`s under the lock; compute every open `draftSlot` in `1..teamCount`
4. if any slots are open, `createMany` one BOT `LeagueMember` per open slot, with `displayName` assigned as ascending stable ordinals (`"CPU 1"`, `"CPU 2"`, …) continuing from the count of BOT rows already in the league
5. return `{ botsCreated, members }` — the same normalized HUMAN/BOT member shape `getLeagueDetail`/`reorderLeagueMembers` already use

Zero open slots is success with `botsCreated: 0`, not a conflict.

Remove flow (`removeBotLeagueMembers`, `apps/web/lib/leagues/remove-bots.ts`):

1. the identical `authorizeLeagueOwner` + `getDraftForLeague` guard
2. `deleteMany({ where: { leagueId, participantType: "BOT" } })` — HUMAN rows are never touched by this query
3. return `{ botsRemoved, members }`

Zero BOT rows is success with `botsRemoved: 0`, not a conflict. Removing bots reopens their `draftSlot`s for a normal HUMAN join or another Fill call.

Removing a BOT pre-Draft is always safe: a bot that has never been part of an ACTIVE Draft has no `Pick` row, so `Pick.leagueMemberId`'s `onDelete: Restrict` FK is never implicated — this is unrelated to "Known issue — League deletion blocked by Pick → LeagueMember FK ordering" below, which is about deleting a League that already has Draft/Pick history.

BOT naming: `displayName` is a stable ordinal, never derived from `draftSlot`. `draftSlot`, not `displayName`, is the sole authoritative draft position — this was a deliberate design choice specifically so a later pre-Draft reorder can never make a bot's name misleading; slot-based naming was considered and rejected for exactly that reason, and this was independently confirmed (not merely reasoned about) with real-Postgres reorder tests during this milestone's own verification.

Concurrency: both services lock the identical League row `joinLeague` and every other commissioner mutation already lock. This produces two proven guarantees with no coordinated code change:

- **Fill vs. Fill** — whichever transaction commits first fills the slots open at that moment; the second re-reads fresh membership after acquiring the lock and fills only what remains open (normally nothing) — never a duplicate `draftSlot`, never more members than `teamCount`.
- **HUMAN join vs. Fill** — if the join wins the lock first, it occupies the lowest free slot normally and Fill (once it acquires the lock) fills only what's left; if Fill wins the lock first, it fills every open slot and the join (once it acquires the lock) sees a full league and receives the existing `LeagueFullError`. Neither outcome can displace a HUMAN, silently evict a BOT, or produce a duplicate slot.

Status mappings (reusing existing error classes, no new ones):

- unauthenticated → `401`
- inaccessible/nonexistent league → `404` (`LeagueNotAccessibleError`)
- non-commissioner → `403` (`NotLeagueOwnerError`)
- Draft already exists → `409` (`DraftAlreadyStartedError`)
- successful Fill/Remove, including an idempotent no-op (`botsCreated`/`botsRemoved` of `0`) → `200` in every case — Fill never returns `201`, since it can legitimately create zero rows
- unexpected internal error → existing unhandled-error (`500`) behavior

No `BotFillConflictError` and no new P2002 target-inspection path were added. The League-row lock, not P2002 remapping, is the actual product-level concurrency guarantee here; the pre-existing "Known maintenance issue — Prisma P2002 constraint metadata" remains deferred and untouched.

Pre-draft UI: commissioner-only `FillBotsForm`/`RemoveBotsForm` (`apps/web/app/leagues/[leagueId]/draft/{fill-bots-form.tsx,remove-bots-form.tsx}`), following `StartDraftForm`'s existing idle/pending/error shape. Both call `router.refresh()` on success so the Server Component re-fetches authoritative `getLeagueDetail` state; neither ever constructs an optimistic BOT membership row client-side. Remove Bots requires a plain `window.confirm(...)` naming that BOT managers will be removed and their slots reopened — no modal system was introduced. Non-commissioners never see either control.

Draft-position discoverability: `reorderLeagueMembers` (unmodified) already operates purely on submitted `LeagueMember.id`s and final array order — it never inspects `participantType`, `userId`, or `displayName`, so a BOT-filled league reorders exactly like an all-human one, and the commissioner is never pinned to slot 1. The pre-draft page exposes a commissioner-only, pre-Draft-only **"Manage draft order"** link to `/leagues/[leagueId]`, where the existing, unmodified `MemberOrderForm` lives — this is a pure discoverability fix (nothing to link to previously existed on the pre-draft page itself), not a second reorder component, not a duplicated reorder API, and not a change to `reorderLeagueMembers` or `startDraft`.

Verified end-to-end product flow (service-level, both LINEAR and SNAKE, including the SNAKE round-1/round-2 boundary):

```text
create league → Fill Open Slots with Bots → Manage draft order (move HUMAN off slot 1)
→ return to /draft → Start Draft → slot-1 BOT on the clock first
→ BOTs process via the existing processBotDraftTurn → HUMAN becomes current at their chosen slot
```

No second mock-draft engine, no second Start Draft path, no fake OAuth identities, and no bot sockets exist anywhere in this flow.

## Data model

Prisma schema, roughly:

- **User** — id, email, name, image, emailVerified, Auth.js relations, domain relations
- **League** — id, name, ownerId, rosterSize, teamCount, inviteCode, timerSeconds, scoringFormat (`STANDARD | PPR | HALF_PPR`), draftType (`SNAKE | LINEAR`)
- **LeagueMember** — id, leagueId, userId (nullable), draftSlot (int, 1-indexed), participantType (`HUMAN | LeagueMemberType.BOT`, default `HUMAN`), displayName (nullable, BOT-only). Unique on `(leagueId, userId)` and `(leagueId, draftSlot)`; a hand-written `CHECK` constraint (Phase 5.1, not expressible via Prisma's schema DSL) enforces `HUMAN ⇔ (userId set, displayName null)` and `BOT ⇔ (userId null, displayName set)` — a bot has no `User` row at all
- **Player** — id, sleeperId, fullName, position, nflTeam, searchRank, injuryStatus
- **PlayerAdp** — id, playerId, format, adp (float, nullable), source. Unique on `(playerId, format)`
- **Draft** — id, leagueId, status (`PENDING | ACTIVE | PAUSED | COMPLETE`), currentPickNumber, currentMemberId (FK → `LeagueMember.id`, `onDelete: SetNull`; Phase 5.1: renamed from `currentUserId`, which FK'd to `User.id`), turnDeadline, startedAt, completedAt
- **Pick** — id, draftId, pickNumber, leagueMemberId (FK → `LeagueMember.id`, `onDelete: Restrict`; Phase 5.1: renamed from `userId`, which FK'd to `User.id`), playerId, wasAutopick, createdAt; unique `(draftId, pickNumber)` and `(draftId, playerId)`
- **ChatMessage** — id, draftId, userId, body, createdAt
- **SocketTicket** — id, token (unique), userId, expiresAt, consumedAt, createdAt; belongs to User with `ON DELETE CASCADE` — always a real human; bots never mint or need a SocketTicket

`LeagueMemberType` enum: `HUMAN | BOT` (Phase 5.1).

Auth.js persistence is modeled with `Account`, `Session`, and `VerificationToken` alongside the domain models above. Authentication is OAuth-only for now, with no password field on `User`. The app uses `User.name` as the canonical user-facing name field.

**Critical constraints:**

- Unique index on `Pick(draftId, playerId)` — the database-level guarantee against double-drafting
- Unique index on `Pick(draftId, pickNumber)` — guarantees no duplicate pick slots
- `Pick.leagueMemberId`'s `onDelete: Restrict` (Phase 5.1) — the database-level guarantee that deleting a `LeagueMember` who has ever picked cannot silently erase that pick's historical attribution; see "Known issue — League deletion blocked by Pick → LeagueMember FK ordering" for a verified interaction this introduces with League deletion

Store ADP in a separate table keyed by scoring format rather than as a column on `Player`. Supporting multiple formats later is a painful migration otherwise.

## Data sources

All external data is fetched by a **seed script**, written to Postgres, and never called on the hot path. During a live draft the app touches only its own database and Redis.

### Sleeper API — player pool

Free, read-only, no authentication. Docs at `https://docs.sleeper.app`.

- `GET https://api.sleeper.app/v1/players/nfl` — full player list. Large payload (several MB); Sleeper asks that it be called at most once per day. Returns an object keyed by player ID.
- Useful fields: `player_id`, `full_name`, `position`, `team`, `search_rank`, `injury_status`, plus cross-reference IDs to other platforms.

**Verify the exact field names against the live response before writing the mapper.** Do not assume the shape from memory — fetch it once, inspect it, then write the types.

### Fantasy Football Calculator — ADP

Free REST API, explicitly offered for third-party use. ADP is derived from live 12-team mock drafts with computer picks filtered out. Covers standard, PPR, half-PPR, 2QB, and dynasty formats.

Base: `https://fantasyfootballcalculator.com/api/v1/adp/{format}` with `year` and `teams` query params. Confirm the current parameter names and response shape by fetching before coding against it.

ADP is required, not optional: it determines default board ordering and drives autopick.

### Name matching between the two sources

Sleeper returns its own player IDs; FFC returns names and teams. Joining them is the fiddliest part of the seed script. Requirements:

- Normalize: lowercase, strip punctuation, strip suffixes (Jr., Sr., II, III), collapse whitespace
- Handle team defenses (`DEF` / `D/ST`) as a special case — they are not people
- Handle players who changed NFL teams between data snapshots (match on name first, team as tiebreak)
- Log unmatched FFC entries rather than silently dropping them
- **Write unit tests for the normalizer.** This is real data-quality work and it should be tested.

Players without an ADP get `null` — do not fabricate a value. Autopick falls back to `search_rank` when ADP is missing.

### Later, for the optional ML phase

`GET https://api.sleeper.app/v1/draft/{draft_id}/picks` returns real completed draft pick sequences. That is genuine training data for a pick-prediction model. `nflverse` (nflfastR data repos on GitHub) publishes free historical play-by-play and seasonal stats as CSV/parquet.

## The draft engine

This is the core of the project. Everything else is scaffolding around it.

### Socket events

Client → server: `draft:join`, `draft:pick`, `draft:chat`, `draft:requestState`

Server → client: `draft:state` (full snapshot), `pick:made`, `turn:changed`, `timer:tick`, `draft:complete`, `user:joined`, `user:left`, `pick:rejected`

Define these payloads as shared TypeScript types imported by both sides. No stringly-typed event data.

**Superseded by "Socket.IO draft protocol conventions" below.** The list above was written before the protocol was implemented. What actually shipped (Milestone 3.3b) is smaller: `draft:join` and `draft:pick` client→server, one `draft:state` full-snapshot event server→client, and acknowledgement-based error codes instead of a standalone `pick:rejected` event. Draft completion is represented inside `draft:state` rather than a separate `draft:complete` event. `draft:chat`, `draft:requestState`, `pick:made`, `turn:changed`, `timer:tick`, `user:joined`, and `user:left` remain unimplemented/deferred (see "Not yet implemented"); if any are built later they are not guaranteed to keep these exact names.

### Pick submission — the critical path

Every pick runs inside a single database transaction:

1. Load the draft row with a row lock (`SELECT ... FOR UPDATE` via Prisma's transaction API)
2. Assert `draft.status === ACTIVE`
3. Assert `draft.currentUserId === submittingUserId`
4. Assert the player is not already picked in this draft
5. Insert the `Pick`
6. Compute the next picker and update `draft.currentPickNumber`, `currentUserId`, `turnDeadline`
7. Commit

If the transaction fails (e.g. on the unique constraint), reject the request through the caller's own error path — an HTTP error status, or a Socket.IO acknowledgement error code — rather than a standalone `pick:rejected` event (see "Socket.IO draft protocol conventions"). Never let a failed pick corrupt draft state or stall the room.

**Superseded by "Pick submission conventions" above (and, as of Phase 5.1, by "Settled decisions").** This list predates both the actual field names and bot participants. Step 3/6's `draft.currentUserId`/`currentUserId` are `Draft.currentMemberId` today, compared against the requester's own `LeagueMember.id` rather than a raw user id, and step 5's `Pick` is written with `leagueMemberId`, not `userId` — see "Pick submission conventions" for the exact current flow. The transactional-safety guarantee this list was written to convey is unchanged; only the identity fields it names are stale.

### Turn order

Snake: odd rounds go slot 1 → N, even rounds go N → 1. Linear: always 1 → N. Write this as a pure function `getPickerForPickNumber(pickNumber, numTeams, draftType)` and **unit test it directly**, especially at round boundaries — that is where snake logic breaks.

### Timers

The server owns the deadline. `turnDeadline` lives on the `Draft` row in Postgres; there is no Redis mirror — `apps/socket-server` discovers expired deadlines directly from Postgres on each sweep tick (see Turn-expiration and autopick conventions above; implemented in Milestone 3.4).

When a deadline passes, the server autopicks: the best available player by ADP (ascending) for the League's scoring format, falling back to `searchRank`. The pick is marked `wasAutopick: true`.

A single self-rescheduling sweep on the socket server checks for expired deadlines (default every 2000ms), not one timer per draft.

### Multi-instance fanout

Socket.IO's Redis adapter so that events published by one instance reach clients connected to another. This must be in place before deploy — test it by running two socket server processes locally against the same Redis.

## Build phases

Do not move to the next phase until the current one's exit criterion is met.

**Phase 1 — Foundation.** Next.js + TypeScript strict scaffold. Prisma schema and first migration. Docker Compose with Postgres and Redis. Auth.js working end to end. Seed script pulling Sleeper players and FFC ADP into the database.
*Done when: you can sign up, log in, and query seeded players with ADP attached.*

**Phase 2 — League Management — COMPLETE**
Goal: authenticated league creation and joining, member visibility with deterministic draft slots, commissioner-only settings and slot management, with server-side authorization and concurrency-safe persistence.

Milestones:
- **2.1 Authenticated League Creation — COMPLETE**
- **2.2 Invite Code + Join — COMPLETE**
- **2.3 League Detail + Members — COMPLETE**
- **2.4 Commissioner Settings + Draft-Slot Management — COMPLETE**
- **2.5 Final Phase Verification — COMPLETE**

Completed Phase 2 surface:
- authenticated league creation
- creator membership at slot 1
- unique invite codes
- explicit league team capacity
- authenticated invite-code joining
- concurrency-safe lowest-available slot assignment
- member-only league detail
- ordered member visibility
- commissioner-only settings mutation
- atomic full-order draft-slot reordering
- server-side mutation authorization
- shared League-row serialization across join/settings/reorder
- real-Postgres integration and concurrency coverage
- final authorization/invariant/data-exposure audit
- manual end-to-end verification

**Phase 2 exit criteria satisfied.**

Phase 2 is frozen as a completed foundation unless a later phase exposes a concrete defect. New functionality should be assigned to the appropriate later phase rather than silently expanding Phase 2.

**Phase 3 — Realtime Draft Engine — COMPLETE**

Milestones:

- **3.1 Draft Start — COMPLETE**
- **3.2 Transactional Pick Submission — COMPLETE**
- **3.3a Shared Draft Service Boundary + Socket Authentication Foundation — COMPLETE**
- **3.3b Socket.IO Draft Protocol + Realtime Integration — COMPLETE**
- **3.4 Server-Owned Timers + Autopick — COMPLETE**
- **3.5 Reconnect/Resync — already delivered as part of 3.3b's basic mint-ticket/reconnect/rejoin/resync mechanism; no standalone 3.5 implementation work remains.** What's genuinely still open (presence, event replay) is tracked under "Not yet implemented" rather than under this milestone number.

**Phase 3 exit criteria satisfied.** Phase 3 is frozen as a completed foundation, the same way Phase 2 was, unless a later phase exposes a concrete defect.

Milestone 3.3b must:
- consume the shared persistence services established in 3.3a
- authenticate sockets using single-use SocketTicket records
- authorize League/draft room access server-side
- expose an authoritative state/resync primitive
- submit realtime picks through the existing `submitPick` service
- broadcast accepted authoritative state to authorized room members
- preserve Postgres/Draft-row locking as the correctness boundary
- remain single-instance for realtime delivery unless later scaling work explicitly introduces Redis

Milestone 3.3b must not:
- duplicate `submitPick`
- import implementation code from `apps/web`
- trust client-supplied identity
- add timer-expiry/autopick behavior
- add presence
- add a temporary HTTP cross-process broadcast bridge
- add Redis prematurely
- become the polished draft-room frontend

**Phase 4 — Client Experience — COMPLETE**

Turns the existing, functionally-complete Phase 3 draft transport into a usable draft-room product: live draft board, available players panel with search and position filter, team rosters, pick timer, and draft-start UI. Pick submission remains server-authoritative and ack/state-driven — the client renders what `draft:state` and pick acknowledgements say, not an optimistic local guess that later rolls back. (This supersedes this section's original "optimistic pick updates that roll back on `pick:rejected`" framing, written before the socket protocol settled on ack-based errors with no standalone `pick:rejected` event — see "Socket.IO draft protocol conventions" above.) Chat and presence indicators remain deferred (see "Not yet implemented"), not committed Phase 4 scope.

Milestones:
- **4.1 Commissioner Draft Start UI — COMPLETE**
- **4.2 Draft Room Shell + Live Turn State — COMPLETE**
- **4.3 Available Players + Search/Filtering — COMPLETE**
- **4.4 Production Pick Submission UX — COMPLETE**
- **4.5 Pre-Draft Experience + Live Draft Room — COMPLETE**
- **4.6 Draft Room UX Hardening + Phase 4 Closeout — COMPLETE**

*Done when: it feels responsive and nothing desyncs or flickers.*

**Phase 4 exit criteria satisfied.** Phase 4 is frozen as a completed foundation the same way Phases 2 and 3 were, unless a later phase exposes a concrete defect.

**Phase 5 — Bot Managers + Mock Drafts — IN PROGRESS.** Renumbered into this slot from the original planning document (which called this slot "Hardening" — see below, now Phase 6); Phase 5 is committed, scoped, and underway, not a future-roadmap idea. Goal: server-owned bot draft participants — never fake Auth.js/OAuth `User` identities — that can occupy draft slots and eventually pick players, building toward mock drafts that fill empty League slots with bots.

Milestones:
- **5.1 Bot Membership / Participant Data Model — COMPLETE**
- **5.2 Basic Best-Available Bot Strategy — COMPLETE**
- **5.3 Server-Side Bot Turn Orchestration — COMPLETE**
- **5.4 Mock Draft Creation / Fill Empty Slots with Bots — COMPLETE**
- **5.5 Position-Aware Bot Strategy — NEXT**
- **5.6 Bot Strategy Variants + Phase 5 Closeout**

Milestone 5.1 delivered the unified HUMAN/BOT `LeagueMember` participant model, the `User.id`-vs-`LeagueMember.id` identity split, the `Draft.currentUserId`→`currentMemberId` and `Pick.userId`→`Pick.leagueMemberId` migration, and normalized HUMAN/BOT member DTOs. Milestone 5.2 extracted the deterministic BEST_AVAILABLE player-selection primitive (`selectBestAvailablePlayerId`, `packages/database/src/drafts/player-selection.ts`) out of the previously-private autopick selector, correcting it to use the same rostered-player eligibility pool as the human Available Players UI and to break exact-ADP ties deterministically, and wired human timer-expiry autopick (`processExpiredDraftTurn`) to call it — decision logic only, no execution path. Milestone 5.3 built that execution path: the existing socket-server turn sweep gained a second phase (`runBotTurnSweep`) that discovers `ACTIVE`/BOT-current Drafts by `participantType` alone (never by `turnDeadline`) and processes exactly one BOT pick per league per tick through a new `processBotDraftTurn` service, reusing the identical `applyPick`/broadcast path every other pick source already uses; `processExpiredDraftTurn` gained the authoritative post-lock guard that makes it safe for BOT and HUMAN turns to share one sweep with no race. Milestone 5.4 closed the product-accessibility gap those three left open: `fillOpenLeagueSlotsWithBots`/`removeBotLeagueMembers` (`apps/web/lib/leagues/`) let a commissioner fill open draft slots with BOT `LeagueMember`s (or clear them) directly from the pre-draft page, pre-Draft only, through the same League-row-lock pattern every other commissioner mutation uses; a **"Manage draft order"** link makes the already-correct-with-no-changes `reorderLeagueMembers` service discoverable from that same page, so a commissioner can move themselves off slot 1 before starting. See "Current implementation status," "Settled decisions," and "Bot fill/remove conventions" for full detail.

**Phase 5.4 is complete: bots are now product-accessible.** A commissioner can legitimately create BOT `LeagueMember`s through the product, optionally remove them, optionally reorder the mixed HUMAN/BOT membership to choose their own draft position, start the resulting league through the unchanged `startDraft`, and have BOT turns processed automatically by the unchanged Phase 5.3 orchestration. One real human can now run a full solo mock draft against bots with no fake accounts and no second draft engine. What Phase 5 has left is bot *strategy*: position-aware drafting (5.5) and strategy variants (5.6) — not accessibility, which 5.4 already delivered.

*Done when: 5.1–5.6 are complete — a mock draft can be created, filled with bots, and drafted to completion with the same server-authoritative correctness guarantees as an all-human draft.*

Phase 5 is not complete; Milestones 5.1–5.4 have shipped.

**Phase 6 — Hardening.** Redis pub/sub adapter. Rate limiting on picks and chat. Structured error responses. Playwright E2E covering a full draft. GitHub Actions running typecheck, lint, and tests.
*Done when: CI is green and two socket instances run safely against one Redis.*

**Phase 7 — Deploy.** Next.js to Vercel. Socket server, Postgres, Redis to Railway or Fly. Environment config, CORS, production migrations, a real URL.
*Done when: you can send a friend the link and draft with them.*

**Phase 8 — ML layer (only after everything above works).** Options, in increasing ambition: a value-over-replacement recommender (statistical, no training); a trained pick-likelihood model served from a small Python FastAPI service; or an LLM pick explainer using the Anthropic API with structured output validation, response caching, and graceful degradation when the call fails. If building the LLM version, the engineering *around* the model — validation, caching, cost tracking, fallback — is the interesting part.

## Conventions

- TypeScript `strict: true`. No `any`. No non-null assertions without a comment justifying them.
- All draft mutations go through the transactional pick path described above. Never write a `Pick` outside it.
- Shared types live in one place and are imported by both the Next app and the socket server. Do not duplicate type definitions.
- Zod for validating all external input: socket payloads, API request bodies, and the shape of data coming back from Sleeper and FFC.
- Prisma migrations are checked in. Never edit the database schema by hand.
- Environment variables validated at startup — fail loudly on boot, not lazily at first use.
- Conventional commits.

### ADP conventions

- Supported scoring formats are `STANDARD` (non-PPR), `HALF_PPR`, and `PPR`.
- ADP varies by scoring format only in this application, not by league size.
- Use the 12-team Fantasy Football Calculator feed as the canonical ADP source for all league sizes.
- Store one `PlayerAdp` record per `(playerId, format)`.
- League size is not part of `PlayerAdp` identity and must not affect which ADP dataset is used.

## Working preferences

- **Write the failing test first for the hard parts.** Specifically: the concurrency test (fire ~50 simultaneous pick requests for the same player, assert exactly one succeeds) and the snake-order test. I want to see them fail before they pass.
- When implementing the transaction logic, timer authority, or reconnect resync, explain the reasoning in comments. I need to be able to re-derive these in an interview.
- Prefer boring, explicit code over clever abstractions.
- Ask before adding a dependency that isn't in the stack table above.

## Explicitly out of scope

Trades, waivers, weekly scoring, season-long league management, mobile apps, payments. This is a draft room. Keep it a draft room.