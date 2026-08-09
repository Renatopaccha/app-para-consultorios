-- A clinic profile is the canonical operational location for both clinics and
-- independent practices. Existing records remain regular clinics by default.
CREATE TYPE "ClinicType" AS ENUM ('CLINIC', 'INDEPENDENT_PRACTICE');

ALTER TABLE "ClinicProfile"
ADD COLUMN "type" "ClinicType" NOT NULL DEFAULT 'CLINIC';

-- Non-destructive backfill for an already modelled independent practice owned
-- by the same user as its doctor profile.
UPDATE "ClinicProfile" AS clinic
SET "type" = 'INDEPENDENT_PRACTICE'
FROM "DoctorProfile" AS doctor
WHERE clinic."userId" = doctor."userId"
  AND doctor."isIndependent" = true;
