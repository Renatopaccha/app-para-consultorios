CREATE TYPE "PatientConfirmationStatus" AS ENUM ('PENDING', 'CONFIRMED', 'DECLINED', 'EXPIRED');
ALTER TABLE "Appointment"
  ADD COLUMN "patientConfirmationStatus" "PatientConfirmationStatus" NOT NULL DEFAULT 'PENDING',
  ADD COLUMN "patientConfirmedAt" TIMESTAMPTZ(3),
  ADD COLUMN "confirmationDeadlineAt" TIMESTAMPTZ(3),
  ADD COLUMN "confirmationReminderSentAt" TIMESTAMPTZ(3);
CREATE INDEX "Appointment_confirmationDeadlineAt_idx" ON "Appointment"("confirmationDeadlineAt");
