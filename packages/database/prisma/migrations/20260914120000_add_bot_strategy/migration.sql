-- Phase 5.6: BOT strategy variants, persisted so strategy identity survives
-- restart/reconnect and follows LeagueMember identity rather than draftSlot
-- or in-memory assignment. Extends the Phase 5.1 participant-shape CHECK
-- constraint rather than replacing it wholesale.

-- CreateEnum
CREATE TYPE "BotStrategy" AS ENUM ('BALANCED', 'RB_HEAVY', 'WR_HEAVY', 'HERO_RB');

ALTER TABLE "LeagueMember" ADD COLUMN "botStrategy" "BotStrategy";

-- Deterministic historical backfill: per league, order existing BOT rows by
-- draftSlot ascending and rotate BALANCED -> RB_HEAVY -> WR_HEAVY -> HERO_RB
-- -> BALANCED ... — the exact same rotation fillOpenLeagueSlotsWithBots uses
-- for newly-created bots going forward. Must run (and be verified complete)
-- before the CHECK constraint below is tightened to require it.
WITH bot_rank AS (
  SELECT "id", (ROW_NUMBER() OVER (PARTITION BY "leagueId" ORDER BY "draftSlot" ASC) - 1) AS rn
  FROM "LeagueMember"
  WHERE "participantType" = 'BOT'
)
UPDATE "LeagueMember" lm
SET "botStrategy" = (ARRAY['BALANCED', 'RB_HEAVY', 'WR_HEAVY', 'HERO_RB']::"BotStrategy"[])[(br.rn % 4) + 1]
FROM bot_rank br
WHERE br."id" = lm."id";

DO $$
DECLARE
  unresolved_count INTEGER;
BEGIN
  SELECT count(*) INTO unresolved_count
  FROM "LeagueMember"
  WHERE "participantType" = 'BOT' AND "botStrategy" IS NULL;

  IF unresolved_count > 0 THEN
    RAISE EXCEPTION
      'BOT botStrategy backfill left % row(s) unresolved; aborting migration.',
      unresolved_count;
  END IF;
END $$;

-- Widen the Phase 5.1 participant-shape CHECK constraint (drop + recreate:
-- Postgres has no ALTER CONSTRAINT for a CHECK expression) to also require
-- botStrategy IS NOT NULL for BOT rows and IS NULL for HUMAN rows. Only
-- runs after the backfill above is verified complete, so no existing row
-- can violate the new predicate.
ALTER TABLE "LeagueMember" DROP CONSTRAINT "LeagueMember_participant_shape_check";

ALTER TABLE "LeagueMember" ADD CONSTRAINT "LeagueMember_participant_shape_check" CHECK (
  ("participantType" = 'HUMAN' AND "userId" IS NOT NULL AND "displayName" IS NULL AND "botStrategy" IS NULL)
  OR
  ("participantType" = 'BOT' AND "userId" IS NULL AND "displayName" IS NOT NULL AND "botStrategy" IS NOT NULL)
);
