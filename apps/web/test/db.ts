import { randomUUID } from "node:crypto";
import { prisma } from "@fdm/database";

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
        `so apps/web/.env.test is loaded before @fdm/database is imported.`,
    );
  }
}

// Deletes explicitly in FK-safe order (children before parents) rather than
// relying on League/LeagueMember's onDelete: Cascade, so cleanup stays
// correct even if cascade configuration changes later.
export async function cleanupLeagueTestData(): Promise<void> {
  assertUsingTestDatabase();
  await prisma.draft.deleteMany();
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
