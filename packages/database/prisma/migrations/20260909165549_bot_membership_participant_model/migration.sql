-- Phase 5.1: bot-membership participant model.
--
-- Hand-written (not the raw `prisma migrate dev` diff) so that old
-- user-based attribution is never dropped until new membership-based
-- attribution has been backfilled and verified complete. This must stay
-- correct whether Draft/Pick are empty (true in dev as of this migration:
-- verified via `SELECT count(*)` immediately before writing this file —
-- see the Phase 5.1 implementation report) or contain real rows.
--
-- Each backfilled column follows the same three-step shape: (1) add the
-- new column nullable, (2) UPDATE it from the old column, (3) a DO block
-- that RAISEs (aborting the whole migration transaction) if any row failed
-- to resolve, before the old column/FK is ever dropped.

-- ============================================================
-- LeagueMember: participant-shape columns + CHECK invariant
-- ============================================================

-- CreateEnum
CREATE TYPE "LeagueMemberType" AS ENUM ('HUMAN', 'BOT');

-- Every existing row keeps its current userId and becomes a valid HUMAN
-- row under the default: participantType = 'HUMAN', displayName = NULL,
-- userId unchanged (still NOT NULL for these rows). No backfill needed —
-- widening NOT NULL -> nullable and adding a defaulted column are both
-- lossless for existing data.
ALTER TABLE "LeagueMember"
  ADD COLUMN "participantType" "LeagueMemberType" NOT NULL DEFAULT 'HUMAN',
  ADD COLUMN "displayName" TEXT;

ALTER TABLE "LeagueMember" ALTER COLUMN "userId" DROP NOT NULL;

-- Enforces: HUMAN <=> (userId set, displayName null); BOT <=> (userId
-- null, displayName set). Not representable via Prisma's schema DSL
-- (`@@check` is not a recognized attribute in Prisma 7.9.1, confirmed via
-- `prisma validate` against a scratch schema before writing this
-- migration), so this constraint is invisible to schema.prisma and must be
-- preserved by hand if this table is touched by a future bare
-- `prisma migrate dev`.
ALTER TABLE "LeagueMember" ADD CONSTRAINT "LeagueMember_participant_shape_check" CHECK (
  ("participantType" = 'HUMAN' AND "userId" IS NOT NULL AND "displayName" IS NULL)
  OR
  ("participantType" = 'BOT' AND "userId" IS NULL AND "displayName" IS NOT NULL)
);

-- ============================================================
-- Draft.currentUserId -> Draft.currentMemberId
-- ============================================================

ALTER TABLE "Draft" ADD COLUMN "currentMemberId" TEXT;

-- Every existing non-null currentUserId names a human who, by definition,
-- has a LeagueMember row in the same league (membership is immutable once
-- a Draft exists, so this mapping can't have drifted since the Draft was
-- created/last advanced).
UPDATE "Draft" d
SET "currentMemberId" = lm."id"
FROM "LeagueMember" lm
WHERE lm."leagueId" = d."leagueId"
  AND lm."userId" = d."currentUserId";

DO $$
DECLARE
  unresolved_count INTEGER;
BEGIN
  SELECT count(*) INTO unresolved_count
  FROM "Draft"
  WHERE "currentUserId" IS NOT NULL AND "currentMemberId" IS NULL;

  IF unresolved_count > 0 THEN
    RAISE EXCEPTION
      'Draft.currentUserId -> currentMemberId backfill left % row(s) unresolved; aborting migration.',
      unresolved_count;
  END IF;
END $$;

ALTER TABLE "Draft" DROP CONSTRAINT "Draft_currentUserId_fkey";
ALTER TABLE "Draft" DROP COLUMN "currentUserId";

-- SetNull: currentMemberId is a live "who's on the clock" pointer, not
-- historical attribution — see schema.prisma's comment on Draft.currentMember.
ALTER TABLE "Draft" ADD CONSTRAINT "Draft_currentMemberId_fkey"
  FOREIGN KEY ("currentMemberId") REFERENCES "LeagueMember"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- ============================================================
-- Pick.userId -> Pick.leagueMemberId
-- ============================================================

ALTER TABLE "Pick" ADD COLUMN "leagueMemberId" TEXT;

-- Every existing Pick's userId names a human who was a LeagueMember of the
-- Pick's own draft's league at the time of the pick, and membership is
-- immutable for the lifetime of an ACTIVE/COMPLETE Draft, so this join is
-- deterministic and total for legitimate existing data.
UPDATE "Pick" p
SET "leagueMemberId" = lm."id"
FROM "Draft" d, "LeagueMember" lm
WHERE d."id" = p."draftId"
  AND lm."leagueId" = d."leagueId"
  AND lm."userId" = p."userId";

DO $$
DECLARE
  unresolved_count INTEGER;
BEGIN
  SELECT count(*) INTO unresolved_count
  FROM "Pick"
  WHERE "leagueMemberId" IS NULL;

  IF unresolved_count > 0 THEN
    RAISE EXCEPTION
      'Pick.userId -> leagueMemberId backfill left % row(s) unresolved; aborting migration.',
      unresolved_count;
  END IF;
END $$;

ALTER TABLE "Pick" DROP CONSTRAINT "Pick_userId_fkey";
ALTER TABLE "Pick" DROP COLUMN "userId";
ALTER TABLE "Pick" ALTER COLUMN "leagueMemberId" SET NOT NULL;

-- Restrict, deliberately not Cascade: the historical-attribution FK this
-- migration exists to protect. See schema.prisma's comment on
-- Pick.leagueMember for the full reasoning.
ALTER TABLE "Pick" ADD CONSTRAINT "Pick_leagueMemberId_fkey"
  FOREIGN KEY ("leagueMemberId") REFERENCES "LeagueMember"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
