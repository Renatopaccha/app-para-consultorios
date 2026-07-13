CREATE EXTENSION IF NOT EXISTS btree_gist;

ALTER TABLE "Appointment"
  ADD COLUMN "startsAt" TIMESTAMPTZ(3),
  ADD COLUMN "endsAt" TIMESTAMPTZ(3),
  ADD COLUMN "previousStartsAt" TIMESTAMPTZ(3),
  ADD COLUMN "previousEndsAt" TIMESTAMPTZ(3);

CREATE TABLE "ScheduleBlock" (
  "id" TEXT NOT NULL,
  "doctorProfileId" TEXT NOT NULL,
  "clinicProfileId" TEXT,
  "startsAt" TIMESTAMPTZ(3) NOT NULL,
  "endsAt" TIMESTAMPTZ(3) NOT NULL,
  "reason" TEXT,
  "createdByUserId" TEXT NOT NULL,
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMPTZ(3) NOT NULL,
  CONSTRAINT "ScheduleBlock_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "ScheduleBlock_doctorProfileId_fkey" FOREIGN KEY ("doctorProfileId") REFERENCES "DoctorProfile"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "ScheduleBlock_clinicProfileId_fkey" FOREIGN KEY ("clinicProfileId") REFERENCES "ClinicProfile"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "ScheduleBlock_valid_interval" CHECK ("endsAt" > "startsAt")
);
CREATE INDEX "ScheduleBlock_doctorProfileId_startsAt_idx" ON "ScheduleBlock"("doctorProfileId", "startsAt");
CREATE INDEX "ScheduleBlock_clinicProfileId_startsAt_idx" ON "ScheduleBlock"("clinicProfileId", "startsAt");
CREATE INDEX "Appointment_startsAt_idx" ON "Appointment"("startsAt");

ALTER TABLE "Appointment" ADD CONSTRAINT "Appointment_no_active_doctor_overlap"
  EXCLUDE USING gist (
    "doctorProfileId" WITH =,
    tstzrange("startsAt", "endsAt", '[)') WITH &&
  ) WHERE ("status" IN ('PENDING', 'CONFIRMED', 'IN_PROGRESS') AND "startsAt" IS NOT NULL AND "endsAt" IS NOT NULL);
