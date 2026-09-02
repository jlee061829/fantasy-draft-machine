import { randomUUID } from "node:crypto";
import { prisma } from "../client.js";

const TEST_DATABASE_NAME = "fantasy_draft_test";

// A configuration mistake here (e.g. running tests without --env-file
// loading .env.test) must fail loudly rather than silently truncating the
// dev database. This check runs before every destructive cleanup call, not
// just once at startup, so it can't be bypassed by import order.
function assertUsingTestDatabase(): void {
  const url = process.env.DATABASE_URL;
  if (!url) {
    throw new Error(
      "DATABASE_URL is not set — refusing to run test database cleanup.",
    );
  }

  let databaseName: string;
  try {
    databaseName = new URL(url).pathname.replace(/^\//, "");
  } catch {
    throw new Error(`DATABASE_URL is not a valid connection URL: ${url}`);
  }

  if (databaseName !== TEST_DATABASE_NAME) {
    throw new Error(
      `Refusing to run test database cleanup: DATABASE_URL points at ` +
        `database "${databaseName}", expected "${TEST_DATABASE_NAME}". ` +
        `Ensure tests are run via the "test" script (node --env-file=.env.test ...) ` +
        `so .env.test is loaded before @fdm/database is imported.`,
    );
  }
}

// Deletes explicitly in FK-safe order (children before parents) rather than
// relying on League/LeagueMember's onDelete: Cascade, so cleanup stays
// correct even if cascade configuration changes later. draft.deleteMany()
// runs first specifically because Pick/ChatMessage both have onDelete:
// Cascade on their draftId relation — deleting Draft rows cascades those
// away at the DB level before player.deleteMany() below would otherwise hit
// a Pick.playerId FK violation (Pick.playerId has no cascade of its own).
//
// fantasy_draft_test never receives real seeded Sleeper/FFC data — the seed
// script (packages/database's db:seed) is a manual command run against the
// dev database only, and no automated test path calls it against this
// database — so every Player row here is a disposable test fixture safe to
// delete in full.
export async function cleanupLeagueTestData(): Promise<void> {
  assertUsingTestDatabase();
  await prisma.draft.deleteMany();
  await prisma.player.deleteMany();
  await prisma.leagueMember.deleteMany();
  await prisma.league.deleteMany();
  await prisma.user.deleteMany();
}

export function testUserData(overrides: Partial<{ email: string; name: string }> = {}) {
  const suffix = randomUUID();
  return {
    email: overrides.email ?? `test-${suffix}@example.com`,
    name: overrides.name ?? "Test User",
  };
}

export async function createTestUser(
  overrides: Partial<{ email: string; name: string }> = {},
) {
  assertUsingTestDatabase();
  return prisma.user.create({ data: testUserData(overrides) });
}

export async function createTestPlayer(
  overrides: Partial<{ fullName: string; position: string; searchRank: number | null }> = {},
) {
  assertUsingTestDatabase();
  const suffix = randomUUID();
  return prisma.player.create({
    data: {
      sleeperId: `test-${suffix}`,
      fullName: overrides.fullName ?? "Test Player",
      position: overrides.position ?? "RB",
      searchRank: overrides.searchRank ?? null,
    },
  });
}
