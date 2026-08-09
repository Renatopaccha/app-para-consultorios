CREATE TYPE "ScheduleBlockVisibility" AS ENUM ('PRIVATE', 'PUBLIC_LABEL');
CREATE TYPE "ScheduleBlockChangeType" AS ENUM ('CREATED', 'UPDATED', 'UNBLOCKED');

ALTER TABLE "ScheduleBlock"
  ADD COLUMN "visibility" "ScheduleBlockVisibility" NOT NULL DEFAULT 'PRIVATE',
  ADD COLUMN "publicLabel" TEXT,
  ADD COLUMN "privateTitle" TEXT,
  ADD COLUMN "internalNotes" TEXT,
  ADD COLUMN "updatedByUserId" TEXT,
  ADD COLUMN "deletedByUserId" TEXT,
  ADD COLUMN "deletedAt" TIMESTAMPTZ(3);

-- Preserve legacy reasons as private titles so that migration cannot disclose
-- existing internal text through a future public-label field.
UPDATE "ScheduleBlock"
SET "privateTitle" = "reason"
WHERE "reason" IS NOT NULL;

ALTER TABLE "Appointment"
  ADD COLUMN "cancellationReasonCode" TEXT,
  ADD COLUMN "cancellationInternalNote" TEXT,
  ADD COLUMN "cancellationPatientMessage" TEXT;

CREATE TABLE "ScheduleBlockChangeLog" (
  "id" TEXT NOT NULL,
  "scheduleBlockId" TEXT NOT NULL,
  "changedByUserId" TEXT NOT NULL,
  "changeType" "ScheduleBlockChangeType" NOT NULL,
  "previousValue" JSONB,
  "newValue" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ScheduleBlockChangeLog_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "ScheduleBlockChangeLog_scheduleBlockId_fkey"
    FOREIGN KEY ("scheduleBlockId") REFERENCES "ScheduleBlock"("id")
    ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX "ScheduleBlock_doctorProfileId_deletedAt_startsAt_idx"
  ON "ScheduleBlock"("doctorProfileId", "deletedAt", "startsAt");
CREATE INDEX "ScheduleBlockChangeLog_scheduleBlockId_createdAt_idx"
  ON "ScheduleBlockChangeLog"("scheduleBlockId", "createdAt");
CREATE INDEX "ScheduleBlockChangeLog_changedByUserId_createdAt_idx"
  ON "ScheduleBlockChangeLog"("changedByUserId", "createdAt");
