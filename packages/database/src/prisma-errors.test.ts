import { describe, expect, it } from "vitest";
import { Prisma } from "./generated/prisma/client.js";
import { uniqueConstraintFields } from "./prisma-errors.js";

// This is the actual defect Phase 6.1 fixes: create-league.ts, join-league.ts,
// and reorder-league-members.ts each had their own copy of a P2002 handler
// that only checked `error.meta.target`. Under this project's real Prisma 7 +
// @prisma/adapter-pg stack, `meta.target` is never populated — the columns
// only ever show up at `error.meta.driverAdapterError.cause.constraint.fields`
// (quoted, e.g. `'"draftId"'`). These tests construct real
// Prisma.PrismaClientKnownRequestError instances shaped exactly like what
// this stack actually throws, rather than the documented-but-inert shape, so
// this proves the fix against the real failure mode instead of an assumed one.
function knownRequestError(code: string, meta?: Record<string, unknown>) {
  return new Prisma.PrismaClientKnownRequestError("Unique constraint failed", {
    code,
    clientVersion: "7.9.1",
    meta,
  });
}

describe("uniqueConstraintFields", () => {
  it("extracts unquoted field names from this stack's actual @prisma/adapter-pg shape", () => {
    const error = knownRequestError("P2002", {
      driverAdapterError: {
        cause: {
          constraint: { fields: ['"leagueId"', '"userId"'] },
        },
      },
    });

    expect(uniqueConstraintFields(error)).toEqual(["leagueId", "userId"]);
  });

  it("prefers meta.target when it is actually populated (the documented Prisma shape)", () => {
    const error = knownRequestError("P2002", { target: ["leagueId", "draftSlot"] });

    expect(uniqueConstraintFields(error)).toEqual(["leagueId", "draftSlot"]);
  });

  it("returns null when a P2002 error carries neither shape", () => {
    const error = knownRequestError("P2002", {});

    expect(uniqueConstraintFields(error)).toBeNull();
  });

  it("returns null for a non-P2002 PrismaClientKnownRequestError", () => {
    const error = knownRequestError("P2025", {
      driverAdapterError: { cause: { constraint: { fields: ['"leagueId"'] } } },
    });

    expect(uniqueConstraintFields(error)).toBeNull();
  });

  it("returns null for a plain, non-Prisma error", () => {
    expect(uniqueConstraintFields(new Error("boom"))).toBeNull();
  });

  it("returns null for a non-error value", () => {
    expect(uniqueConstraintFields(undefined)).toBeNull();
    expect(uniqueConstraintFields("some string")).toBeNull();
  });
});
