# Fantasy Football Draft Room — Project Brief

## What we're building

A real-time, multiplayer fantasy football draft room. Multiple users join a league, enter a live draft room, and take turns picking players from a shared pool. Every connected client sees picks, timers, and presence updates instantly. If a user's pick timer expires, the server autopicks for them. If a user disconnects mid-draft, they can reconnect and resync without stalling the draft for everyone else.

This is a portfolio project. The point is not to compete with Sleeper or ESPN — it is to demonstrate correct handling of concurrent writes, server-authoritative real-time state, and full-stack TypeScript with a real deployment. Prioritize correctness and clarity over feature count.

## Current implementation status

Last updated: August 2026

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
  - 45 total seed-pipeline tests passing
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

### Current phase

**Phase 1 — Foundation — COMPLETE**

Phase 1 exit criterion satisfied: users can authenticate with GitHub and authenticated application code can query seeded 2026 NFL players with scoring-format-specific ADP attached.

Next phase: **Phase 2 — League Management**

### Not yet implemented

- league creation and join-by-invite-code flows
- league membership and draft-slot management
- league settings/configuration UI
- Socket.IO draft protocol and realtime draft engine
- Redis-backed Socket.IO scaling / timer coordination
- draft room UI
- autopick
- reconnect/resync behavior
- GitHub Actions CI
- ML recommendation system

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

## Data model

Prisma schema, roughly:

- **User** — id, email, name, image, emailVerified, Auth.js relations, domain relations
- **League** — id, name, ownerId, rosterSize, timerSeconds, scoringFormat (`STANDARD | PPR | HALF_PPR`), draftType (`SNAKE | LINEAR`)
- **LeagueMember** — id, leagueId, userId, draftSlot (int, 1-indexed). Unique on `(leagueId, userId)` and `(leagueId, draftSlot)`
- **Player** — id, sleeperId, fullName, position, nflTeam, searchRank, injuryStatus
- **PlayerAdp** — id, playerId, format, adp (float, nullable), source. Unique on `(playerId, format)`
- **Draft** — id, leagueId, status (`PENDING | ACTIVE | PAUSED | COMPLETE`), currentPickNumber, currentUserId, turnDeadline (timestamp)
- **Pick** — id, draftId, pickNumber, userId, playerId, wasAutopick (bool), createdAt
- **ChatMessage** — id, draftId, userId, body, createdAt

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

### Pick submission — the critical path

Every pick runs inside a single database transaction:

1. Load the draft row with a row lock (`SELECT ... FOR UPDATE` via Prisma's transaction API)
2. Assert `draft.status === ACTIVE`
3. Assert `draft.currentUserId === submittingUserId`
4. Assert the player is not already picked in this draft
5. Insert the `Pick`
6. Compute the next picker and update `draft.currentPickNumber`, `currentUserId`, `turnDeadline`
7. Commit

If the transaction fails on the unique constraint, emit `pick:rejected` to that client only. Never let a failed pick corrupt draft state or stall the room.

### Turn order

Snake: odd rounds go slot 1 → N, even rounds go N → 1. Linear: always 1 → N. Write this as a pure function `getPickerForPickNumber(pickNumber, numTeams, draftType)` and **unit test it directly**, especially at round boundaries — that is where snake logic breaks.

### Timers

The server owns the deadline. Store `turnDeadline` on the draft row and mirror it in Redis with a TTL. Clients receive the deadline timestamp and render their own countdown — they never report expiry.

When a deadline passes, the server autopicks: the best available player by ADP (ascending), falling back to `search_rank`. Mark the pick `wasAutopick: true`.

Use a single interval on the socket server that checks for expired deadlines, not one timer per draft.

### Multi-instance fanout

Socket.IO's Redis adapter so that events published by one instance reach clients connected to another. This must be in place before deploy — test it by running two socket server processes locally against the same Redis.

## Build phases

Do not move to the next phase until the current one's exit criterion is met.

**Phase 1 — Foundation.** Next.js + TypeScript strict scaffold. Prisma schema and first migration. Docker Compose with Postgres and Redis. Auth.js working end to end. Seed script pulling Sleeper players and FFC ADP into the database.
*Done when: you can sign up, log in, and query seeded players with ADP attached.*

**Phase 2 — League management.** Create a league. Join by invite code. Member list with draft slots. Commissioner-only settings. Authorization enforced server-side on every mutation, not by hiding UI.
*Done when: two separate accounts can create and join the same league.*

**Phase 3 — Draft engine.** The socket server, the event protocol, transactional pick submission, snake turn order, server-owned timers, autopick, reconnect resync.
*Done when: two browsers complete a full draft including a timer expiry and a mid-draft refresh, and the concurrency test passes.*

**Phase 4 — Client experience.** Live draft board. Available players panel with search and position filter. My-roster view. Pick timer. Chat. Presence indicators. Optimistic pick updates that roll back on `pick:rejected`.
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