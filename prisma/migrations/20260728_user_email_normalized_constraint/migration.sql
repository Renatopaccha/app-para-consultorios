-- Promote the backfilled canonical email from a transitional partial index to
-- a real PostgreSQL unique constraint. Abort safely rather than choosing a
-- winner if legacy data is malformed or collides after normalization.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM "User" WHERE "emailNormalized" IS NULL OR btrim("emailNormalized") = '') THEN
    RAISE EXCEPTION 'Cannot enforce User.emailNormalized: null or blank canonical emails exist.';
  END IF;
  IF EXISTS (
    SELECT 1
    FROM "User"
    GROUP BY "emailNormalized"
    HAVING count(*) > 1
  ) THEN
    RAISE EXCEPTION 'Cannot enforce User.emailNormalized: duplicate canonical emails exist.';
  END IF;
END $$;

DROP INDEX IF EXISTS "User_emailNormalized_key";
ALTER TABLE "User" ALTER COLUMN "emailNormalized" SET NOT NULL;
ALTER TABLE "User" ADD CONSTRAINT "User_emailNormalized_key" UNIQUE ("emailNormalized");
