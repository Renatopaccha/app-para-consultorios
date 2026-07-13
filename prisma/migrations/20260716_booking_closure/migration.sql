CREATE TYPE "AppointmentChangeType" AS ENUM ('CREATED', 'RESCHEDULED', 'CANCELLED', 'STATUS_CHANGED');
ALTER TABLE "Appointment" ADD COLUMN "cancelledAt" TIMESTAMPTZ(3), ADD COLUMN "cancelledByUserId" TEXT;
CREATE TABLE "AppointmentChangeLog" (
 "id" TEXT NOT NULL, "appointmentId" TEXT NOT NULL, "changedByUserId" TEXT NOT NULL, "changeType" "AppointmentChangeType" NOT NULL,
 "previousStartsAt" TIMESTAMPTZ(3), "previousEndsAt" TIMESTAMPTZ(3), "newStartsAt" TIMESTAMPTZ(3), "newEndsAt" TIMESTAMPTZ(3),
 "previousStatus" "AppointmentStatus", "newStatus" "AppointmentStatus", "reason" TEXT, "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 CONSTRAINT "AppointmentChangeLog_pkey" PRIMARY KEY ("id"), CONSTRAINT "AppointmentChangeLog_appointmentId_fkey" FOREIGN KEY ("appointmentId") REFERENCES "Appointment"("id") ON DELETE CASCADE ON UPDATE CASCADE);
CREATE INDEX "AppointmentChangeLog_appointmentId_createdAt_idx" ON "AppointmentChangeLog"("appointmentId", "createdAt");
ALTER TABLE "Appointment" ADD CONSTRAINT "Appointment_active_interval_required" CHECK (
 ("status" NOT IN ('PENDING','CONFIRMED','IN_PROGRESS')) OR ("startsAt" IS NOT NULL AND "endsAt" IS NOT NULL AND "endsAt" > "startsAt")
);
