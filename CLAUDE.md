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
  - known residual edge, deliberately not addressed in 4.4: the server's current order is commit → `{ok:true}` ack → `draft:state` broadcast; if the commit and success ack both succeed but the subsequent broadcast is somehow lost while the socket remains connected (no `disconnect` fires), the client's pending state would stay stuck with no further signal to clear it — no timeout/forced-resync machinery was added for this in 4.4; it is deferred to Milestone 4.6
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

### Current phase

**Phase 4 — Client Experience — IN PROGRESS**

Completed:

- Phase 1 — Foundation — COMPLETE
- Phase 2 — League Management — COMPLETE
- Phase 3 — Realtime Draft Engine — COMPLETE (Milestones 3.1, 3.2, 3.3a, 3.3b, 3.4; see "Milestone 3.5 status" below for why there is no separate 3.5)
- Phase 4 Milestone 4.1 — Commissioner Draft Start UI — COMPLETE
- Phase 4 Milestone 4.2 — Draft Room Shell + Live Turn State — COMPLETE
- Phase 4 Milestone 4.3 — Available Players + Search/Filtering — COMPLETE
- Phase 4 Milestone 4.4 — Production Pick Submission UX — COMPLETE

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

Next objective: Phase 3's originally-scoped milestones (3.1–3.4, plus the reconnect/resync capability originally scoped as 3.5 — see note above) are all complete, and Phase 3 is frozen as a completed foundation the same way Phase 2 was — unless a later phase exposes a concrete defect. Horizontal scalability (Redis pub/sub across multiple socket-server instances) remains explicitly deferred to Phase 5. Phase 4 (client experience) is now in progress against the settled milestone structure in "Build phases" below; Milestones 4.1 — Commissioner Draft Start UI, 4.2 — Draft Room Shell + Live Turn State, 4.3 — Available Players + Search/Filtering, and 4.4 — Production Pick Submission UX are complete. Milestone 4.5 — Draft Board + Team Rosters is the next objective.

### Not yet implemented

- Redis-backed cross-process/multi-instance realtime publication
- immediate Socket.IO publication of successful HTTP-originated mutations
- event replay or more sophisticated reconnect recovery beyond the basic mint-ticket/rejoin/resync mechanism delivered in 3.3b
- presence (`user:joined`/`user:left`, socket-disconnect-driven room cleanup)
- chat
- polished draft-board UI (a basic, cosmetic turn countdown shipped in Milestone 4.2, and per-row Draft actions shipped in Milestone 4.4 — see Milestone 4.5 for the draft board itself)
- hardening the rare ack-success/`draft:state`-broadcast-failure edge in pick-submission UX, where a pick could commit and ack successfully but its subsequent broadcast is lost while the socket stays connected, leaving client pending state stuck (deferred to Milestone 4.6 — see Milestone 4.4's completed-work notes)
- pause/resume
- draft/pick undo
- roster-position enforcement, including roster-aware autopick selection, if later required
- ML recommendation system
- GitHub Actions CI

### Deferred decisions

- Socket authentication strategy — decide before Phase 3
- Railway vs. Fly.io for socket-server deployment — decide before Phase 6

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
- League roster size validation: integer 8–25, default 16
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
- a completed Draft retains the final `currentPickNumber` and clears `currentUserId` and `turnDeadline`
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
- autopick selection order is: lowest available ADP for the League's scoring format, then lowest `searchRank` (nulls last), then `id` ascending as a final deterministic tiebreak
- autopick does not yet consider roster position
- Socket.IO broadcasts authoritative state only after a real (non-no-op) turn-consuming mutation, manual or automatic
- restart recovery for timer/autopick state comes from rediscovering expired deadlines in Postgres on the next sweep tick, not from reconstructing in-memory timers
- the basic reconnect/resync mechanism (fresh SocketTicket, reconnect, `draft:join`, authoritative resync) was delivered in 3.3b and required no changes for 3.4; it already reflects any autopick-driven state that occurred while a client was disconnected
- `/leagues` lists Leagues by `LeagueMember` membership only; League ownership is never queried separately for this purpose
- Phase 4 milestones are: 4.1 Commissioner Draft Start UI, 4.2 Draft Room Shell + Live Turn State, 4.3 Available Players + Search/Filtering, 4.4 Production Pick Submission UX, 4.5 Draft Board + Team Rosters, 4.6 Draft Room UX Hardening + Phase 4 Closeout
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
- the rare edge where a pick's commit and success ack both succeed but its subsequent `draft:state` broadcast is lost while the socket stays connected (leaving client pending state stuck with no further signal) was deliberately not addressed in 4.4 and is deferred to Milestone 4.6
- the temporary raw `playerId` debug form was removed from the normal production draft-room UI in Milestone 4.4; arbitrary/invalid player-ID behavior remains covered by the existing automated server-side tests
- the Available Players table displays a stable integer **ADP Rank** — each player's 1-indexed position within the full ADP-sorted pool — instead of the raw decimal `PlayerAdp.adp` value; the rank is never derived by rounding/flooring the raw ADP
- ADP Rank is computed client-side (`computeAdpRanks` in `available-players-helpers.ts`) from the full, unfiltered player pool, never from the currently filtered/searched subset, so a player's rank stays fixed regardless of search or position filtering
- a player with `adp === null` remains unranked (displays `—`); no ADP Rank is invented for a player with no ADP
- persisted `PlayerAdp.adp`, server-side available-player ordering, and autopick selection are unaffected by ADP Rank — it is a presentation-only client-side derivation

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
  - authoritative draft mutation/query services such as `submitPick`, `getDraftState`, `getDraftStateForLeague`, `processExpiredDraftTurn`, and `findExpiredActiveDraftLeagueIds`
  - socket-ticket persistence services
  - test-only database helpers exposed separately through `@fdm/database/test-support`
  - `lockDraftForLeague`, `applyPick`, and `selectAutopickPlayerId` are internal implementation details shared between `submitPick` and `processExpiredDraftTurn`, not part of the package's public surface

- `apps/web`
  - Next.js HTTP/Auth/UI adapter
  - owns HTTP request validation
  - must call shared persistence services rather than duplicating their transaction logic

- `apps/socket-server`
  - Socket.IO/auth/room transport adapter, plus server-side turn-expiration timer orchestration
  - owns the recurring turn-expiration sweep that triggers autopick via `@fdm/database`
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
- `currentUserId = first picker`
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
- `currentUserId`
- `turnDeadline`

Manual pick submission flow:

1. verify the requester is a current `LeagueMember`
2. lock the League's Draft row with `SELECT ... FOR UPDATE`
3. require an existing Draft
4. require `Draft.status = ACTIVE`
5. require `Draft.currentUserId === requestingUserId`
6. load immutable League draft configuration
7. require the selected Player to exist
8. reject a Player already drafted in this Draft
9. create the Pick at `Draft.currentPickNumber` with `wasAutopick = false`
10. determine whether the Pick is final
11. for a non-final Pick:
    - increment `currentPickNumber`
    - compute the next `draftSlot` with `getPickerForPickNumber`
    - resolve that slot to its `LeagueMember.userId`
    - update `currentUserId`
    - set a new server-owned `turnDeadline`
12. for the final Pick:
    - set `status = COMPLETE`
    - retain `currentPickNumber = totalPicks`
    - set `currentUserId = null`
    - set `turnDeadline = null`
13. commit and return an explicit DTO

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
- `currentUserId === null`
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

### Turn-expiration and autopick conventions

`apps/socket-server` owns a single recurring, self-rescheduling turn-expiration sweep (`startTurnSweep`/`stopTurnSweep`/`runSweepOnce`, default interval 2000ms via `DEFAULT_SWEEP_INTERVAL_MS`), started from `index.ts`'s real process lifecycle and stopped on graceful shutdown. It is not started inside `createSocketServer()`, so tests that build a server via `createSocketServer()`/`startTestServer()` never silently inherit a live background DB-polling interval.

Each tick:

1. `findExpiredActiveDraftLeagueIds()` — a plain, unlocked Postgres read for `Draft.status = ACTIVE AND turnDeadline <= now`
2. for each candidate League, `processExpiredDraftTurn(leagueId)` locks the Draft row (`lockDraftForLeague`, the same lock `submitPick` uses) and re-validates expiry *inside* the lock
3. a candidate that went stale between discovery and lock acquisition (already picked, no longer `ACTIVE`, deadline no longer past) returns a `"skipped"` outcome — a routine no-op, not an error
4. a genuinely expired turn selects the next Pick via `selectAutopickPlayerId` and applies it through the same internal `applyPick(...)` used by `submitPick`, with `wasAutopick: true`
5. only a `"picked"` outcome triggers `broadcastDraftState(...)` — one authoritative `draft:state` snapshot to `league:${leagueId}`

Because manual picks and autopicks lock and re-validate against the identical Draft row, a manual-pick-vs-autopick race and a duplicate-sweep-vs-sweep race both resolve to exactly one turn consumer — the same guarantee Milestone 3.2 established for concurrent manual submissions.

Autopick player selection (`selectAutopickPlayerId`), scoped to Players not yet drafted in the Draft:
- tier 1: lowest `PlayerAdp.adp` for the League's `scoringFormat`
- tier 2 (fallback when no undrafted Player has an ADP row for that format): lowest `Player.searchRank`, nulls last, `id asc` as a final deterministic tiebreak
- no roster-position awareness yet
- an exhausted pool (no undrafted Player at all) throws `AutopickExhaustedError` — an internal data/configuration invariant failure (the seeded Player pool is smaller than `teamCount * rosterSize`), not a normal skip; it is logged and left for a later sweep tick rather than crashing the sweep for other leagues. This is expected to remain retryable-but-failing until the underlying seed/roster-size mismatch is corrected — it is not something later sweeps are expected to resolve on their own.

Restart recovery is a byproduct of polling live Postgres state rather than a separate feature: a freshly started socket-server process discovers exactly the same expired/future deadlines a long-running process would, with no in-memory timer state to reconstruct.

Public correctness services: `submitPick` (manual) and `processExpiredDraftTurn` (automatic). `lockDraftForLeague`, `applyPick`, and `selectAutopickPlayerId` are internal `@fdm/database` implementation details, not part of the public surface.

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

## Data model

Prisma schema, roughly:

- **User** — id, email, name, image, emailVerified, Auth.js relations, domain relations
- **League** — id, name, ownerId, rosterSize, teamCount, inviteCode, timerSeconds, scoringFormat (`STANDARD | PPR | HALF_PPR`), draftType (`SNAKE | LINEAR`)
- **LeagueMember** — id, leagueId, userId, draftSlot (int, 1-indexed). Unique on `(leagueId, userId)` and `(leagueId, draftSlot)`
- **Player** — id, sleeperId, fullName, position, nflTeam, searchRank, injuryStatus
- **PlayerAdp** — id, playerId, format, adp (float, nullable), source. Unique on `(playerId, format)`
- **Draft** — id, leagueId, status (`PENDING | ACTIVE | PAUSED | COMPLETE`), currentPickNumber, currentUserId, turnDeadline, startedAt, completedAt
- **Pick** — id, draftId, pickNumber, userId, playerId, wasAutopick, createdAt; unique `(draftId, pickNumber)` and `(draftId, playerId)`
- **ChatMessage** — id, draftId, userId, body, createdAt
- **SocketTicket** — id, token (unique), userId, expiresAt, consumedAt, createdAt; belongs to User with `ON DELETE CASCADE`

Auth.js persistence is modeled with `Account`, `Session`, and `VerificationToken` alongside the domain models above. Authentication is OAuth-only for now, with no password field on `User`. The app uses `User.name` as the canonical user-facing name field.

**Critical constraints:**

- Unique index on `Pick(draftId, playerId)` — the database-level guarantee against double-drafting
- Unique index on `Pick(draftId, pickNumber)` — guarantees no duplicate pick slots

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

**Phase 4 — Client Experience — IN PROGRESS**

Turns the existing, functionally-complete Phase 3 draft transport into a usable draft-room product: live draft board, available players panel with search and position filter, team rosters, pick timer, and draft-start UI. Pick submission remains server-authoritative and ack/state-driven — the client renders what `draft:state` and pick acknowledgements say, not an optimistic local guess that later rolls back. (This supersedes this section's original "optimistic pick updates that roll back on `pick:rejected`" framing, written before the socket protocol settled on ack-based errors with no standalone `pick:rejected` event — see "Socket.IO draft protocol conventions" above.) Chat and presence indicators remain deferred (see "Not yet implemented"), not committed Phase 4 scope.

Milestones:
- **4.1 Commissioner Draft Start UI — COMPLETE**
- **4.2 Draft Room Shell + Live Turn State — COMPLETE**
- **4.3 Available Players + Search/Filtering — COMPLETE**
- **4.4 Production Pick Submission UX — COMPLETE**
- **4.5 Draft Board + Team Rosters — NEXT**
- **4.6 Draft Room UX Hardening + Phase 4 Closeout**

*Done when: it feels responsive and nothing desyncs or flickers.*

**Phase 5 — Hardening.** Redis pub/sub adapter. Rate limiting on picks and chat. Structured error responses. Playwright E2E covering a full draft. GitHub Actions running typecheck, lint, and tests.
*Done when: CI is green and two socket instances run safely against one Redis.*

**Phase 6 — Deploy.** Next.js to Vercel. Socket server, Postgres, Redis to Railway or Fly. Environment config, CORS, production migrations, a real URL.
*Done when: you can send a friend the link and draft with them.*

**Phase 7 — ML layer (only after everything above works).** Options, in increasing ambition: a value-over-replacement recommender (statistical, no training); a trained pick-likelihood model served from a small Python FastAPI service; or an LLM pick explainer using the Anthropic API with structured output validation, response caching, and graceful degradation when the call fails. If building the LLM version, the engineering *around* the model — validation, caching, cost tracking, fallback — is the interesting part.

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