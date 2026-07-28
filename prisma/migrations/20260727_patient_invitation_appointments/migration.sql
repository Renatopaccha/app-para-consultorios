CREATE TYPE "PatientInvitationStatus" AS ENUM ('PENDING', 'ACCEPTED', 'EXPIRED', 'REVOKED');

ALTER TABLE "User"
  ADD COLUMN "emailNormalized" TEXT,
  ADD COLUMN "emailVerifiedAt" TIMESTAMPTZ(3),
  ADD COLUMN "emailVerificationTokenHash" TEXT,
  ADD COLUMN "emailVerificationExpires" TIMESTAMPTZ(3);

-- Existing accounts predate explicit verification. Preserve their access while
-- all new registrations must verify before invited appointments are claimed.
UPDATE "User"
SET "emailNormalized" = lower(trim("email")),
    "emailVerifiedAt" = COALESCE("emailVerifiedAt", "createdAt");

CREATE UNIQUE INDEX "User_emailNormalized_key" ON "User"("emailNormalized") WHERE "emailNormalized" IS NOT NULL;
CREATE UNIQUE INDEX "User_emailVerificationTokenHash_key" ON "User"("emailVerificationTokenHash") WHERE "emailVerificationTokenHash" IS NOT NULL;

CREATE TABLE "PatientInvitation" (
  "id" TEXT NOT NULL,
  "email" TEXT NOT NULL,
  "emailNormalized" TEXT NOT NULL,
  "firstName" TEXT NOT NULL,
  "lastName" TEXT NOT NULL,
  "phone" TEXT,
  "tokenHash" TEXT NOT NULL,
  "status" "PatientInvitationStatus" NOT NULL DEFAULT 'PENDING',
  "expiresAt" TIMESTAMPTZ(3) NOT NULL,
  "acceptedAt" TIMESTAMPTZ(3),
  "revokedAt" TIMESTAMPTZ(3),
  "invitedByUserId" TEXT NOT NULL,
  "doctorProfileId" TEXT,
  "clinicProfileId" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "PatientInvitation_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "PatientInvitation_tokenHash_key" ON "PatientInvitation"("tokenHash");
CREATE INDEX "PatientInvitation_emailNormalized_status_idx" ON "PatientInvitation"("emailNormalized", "status");
CREATE INDEX "PatientInvitation_expiresAt_idx" ON "PatientInvitation"("expiresAt");
CREATE INDEX "PatientInvitation_doctorProfileId_clinicProfileId_idx" ON "PatientInvitation"("doctorProfileId", "clinicProfileId");
-- The state is part of the predicate so expired/revoked history is retained.
CREATE UNIQUE INDEX "PatientInvitation_one_pending_email" ON "PatientInvitation"("emailNormalized") WHERE "status" = 'PENDING';

ALTER TABLE "Appointment"
  ALTER COLUMN "patientId" DROP NOT NULL,
  ADD COLUMN "patientInvitationId" TEXT,
  ADD COLUMN "invitedPatientFirstName" TEXT,
  ADD COLUMN "invitedPatientLastName" TEXT,
  ADD COLUMN "invitedPatientEmail" TEXT,
  ADD COLUMN "invitedPatientPhone" TEXT;

CREATE INDEX "Appointment_patientInvitationId_idx" ON "Appointment"("patientInvitationId");
ALTER TABLE "Appointment" ADD CONSTRAINT "Appointment_patient_or_invitation"
  CHECK ("patientId" IS NOT NULL OR "patientInvitationId" IS NOT NULL);

ALTER TABLE "PatientInvitation" ADD CONSTRAINT "PatientInvitation_invitedByUserId_fkey" FOREIGN KEY ("invitedByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "PatientInvitation" ADD CONSTRAINT "PatientInvitation_doctorProfileId_fkey" FOREIGN KEY ("doctorProfileId") REFERENCES "DoctorProfile"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "PatientInvitation" ADD CONSTRAINT "PatientInvitation_clinicProfileId_fkey" FOREIGN KEY ("clinicProfileId") REFERENCES "ClinicProfile"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "Appointment" ADD CONSTRAINT "Appointment_patientInvitationId_fkey" FOREIGN KEY ("patientInvitationId") REFERENCES "PatientInvitation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
