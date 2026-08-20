-- teamCount: add with a temporary DEFAULT so existing rows backfill, then
-- drop the default so future inserts must always supply it explicitly
-- (consistent with rosterSize/timerSeconds, which have no DB-level default).
ALTER TABLE "League" ADD COLUMN "teamCount" INTEGER NOT NULL DEFAULT 12;
ALTER TABLE "League" ALTER COLUMN "teamCount" DROP DEFAULT;

-- inviteCode: add nullable, backfill each existing row with a real,
-- collision-checked code drawn from the same alphabet application code
-- generates (see apps/web/lib/leagues/invite-code.ts), then enforce
-- NOT NULL + unique. Works correctly with zero, one, or many existing rows.
ALTER TABLE "League" ADD COLUMN "inviteCode" TEXT;

DO $$
DECLARE
  alphabet TEXT := 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
  league_row RECORD;
  candidate TEXT;
  i INT;
BEGIN
  FOR league_row IN SELECT id FROM "League" WHERE "inviteCode" IS NULL LOOP
    LOOP
      candidate := '';
      FOR i IN 1..8 LOOP
        candidate := candidate || substr(alphabet, floor(random() * length(alphabet))::int + 1, 1);
      END LOOP;
      -- Checked against the live table, which already reflects codes
      -- assigned earlier in this same loop, not just pre-existing rows.
      EXIT WHEN NOT EXISTS (SELECT 1 FROM "League" WHERE "inviteCode" = candidate);
    END LOOP;
    UPDATE "League" SET "inviteCode" = candidate WHERE id = league_row.id;
  END LOOP;
END $$;

ALTER TABLE "League" ALTER COLUMN "inviteCode" SET NOT NULL;

-- CreateIndex
CREATE UNIQUE INDEX "League_inviteCode_key" ON "League"("inviteCode");
