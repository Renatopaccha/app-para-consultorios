-- Incremental compatibility migration. Legacy price/Float columns remain untouched.
CREATE TYPE "Currency" AS ENUM ('USD');

ALTER TABLE "Service"
  ADD COLUMN "priceCents" INTEGER,
  ADD COLUMN "currency" "Currency" NOT NULL DEFAULT 'USD',
  ADD COLUMN "isActive" BOOLEAN NOT NULL DEFAULT true;

ALTER TABLE "Appointment"
  ADD COLUMN "serviceNameSnapshot" TEXT,
  ADD COLUMN "servicePriceCentsSnapshot" INTEGER,
  ADD COLUMN "serviceDurationMinutesSnapshot" INTEGER,
  ADD COLUMN "currencySnapshot" "Currency",
  ADD COLUMN "paymentAmountCents" INTEGER,
  ADD COLUMN "paymentCurrency" "Currency";

CREATE INDEX "Appointment_servicePriceCentsSnapshot_idx" ON "Appointment"("servicePriceCentsSnapshot");
