import { Prisma } from "./generated/prisma/client.js";

// Prisma's documented P2002 shape puts the violated columns at
// `error.meta.target`, and that's the shape every P2002 handler in this
// codebase originally assumed. Under this project's actual Prisma 7 +
// @prisma/adapter-pg setup, though, `meta.target` is never populated — the
// columns instead show up at `error.meta.driverAdapterError.cause.constraint.fields`,
// quoted (e.g. `"draftId"`). Checking `target` first keeps this
// forward-compatible with the documented shape should the adapter's error
// normalization change; the driverAdapterError fallback is what actually
// fires today.
//
// Originally written only inside submit-pick.ts (Milestones 3.2/3.4).
// Relocated here (Phase 6.1) so every P2002 handler in the codebase — not
// just the draft-pick path — recognizes the real error shape this stack
// actually produces, instead of falling through to an unmapped error.
export function uniqueConstraintFields(error: unknown): string[] | null {
  if (!(error instanceof Prisma.PrismaClientKnownRequestError) || error.code !== "P2002") {
    return null;
  }
  const meta = error.meta as
    | { target?: unknown; driverAdapterError?: { cause?: { constraint?: { fields?: unknown } } } }
    | undefined;
  if (Array.isArray(meta?.target)) {
    return meta.target as string[];
  }
  const fields = meta?.driverAdapterError?.cause?.constraint?.fields;
  if (Array.isArray(fields)) {
    return fields.map((field) => String(field).replace(/^"|"$/g, ""));
  }
  return null;
}
