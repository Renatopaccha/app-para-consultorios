CREATE TYPE "PaymentMethod" AS ENUM ('CASH', 'CARD', 'BANK_TRANSFER');
CREATE TYPE "CashPaymentStatus" AS ENUM ('PENDING', 'CONFIRMED', 'CANCELLED', 'REFUNDED', 'EXEMPTED');
CREATE TYPE "PaymentEventType" AS ENUM ('CREATED', 'CODE_REISSUED', 'LOOKUP_SUCCEEDED', 'LOOKUP_FAILED', 'CONFIRMED', 'CANCELLED', 'CANCELLED_AFTER_CONFIRMATION_REQUIRES_REVIEW', 'REFUND_MARKED', 'STATUS_CHANGED');

CREATE TABLE "Payment" (
  "id" TEXT NOT NULL,
  "appointmentId" TEXT NOT NULL,
  "method" "PaymentMethod" NOT NULL,
  "status" "CashPaymentStatus" NOT NULL DEFAULT 'PENDING',
  "amountCents" INTEGER NOT NULL,
  "currency" "Currency" NOT NULL,
  "verificationCodeHash" TEXT,
  "verificationCodeLast4" TEXT,
  "codeExpiresAt" TIMESTAMPTZ(3) NOT NULL,
  "failedVerificationAttempts" INTEGER NOT NULL DEFAULT 0,
  "lockedUntil" TIMESTAMPTZ(3),
  "confirmedAt" TIMESTAMPTZ(3),
  "confirmedByUserId" TEXT,
  "confirmedClinicId" TEXT,
  "cancelledAt" TIMESTAMPTZ(3),
  "cancellationReason" TEXT,
  "requiresReview" BOOLEAN NOT NULL DEFAULT false,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "Payment_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "PaymentEvent" (
  "id" TEXT NOT NULL,
  "paymentId" TEXT NOT NULL,
  "eventType" "PaymentEventType" NOT NULL,
  "previousStatus" "CashPaymentStatus",
  "newStatus" "CashPaymentStatus",
  "actorUserId" TEXT,
  "clinicId" TEXT,
  "metadata" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "PaymentEvent_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "PaymentIdempotencyKey" (
  "id" TEXT NOT NULL,
  "key" TEXT NOT NULL,
  "scope" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "paymentId" TEXT NOT NULL,
  "responseBody" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "PaymentIdempotencyKey_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "PaymentVerificationAttempt" (
  "id" TEXT NOT NULL,
  "paymentId" TEXT,
  "actorUserId" TEXT,
  "ipHash" TEXT NOT NULL,
  "success" BOOLEAN NOT NULL DEFAULT false,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "PaymentVerificationAttempt_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "Payment_appointmentId_key" ON "Payment"("appointmentId");
CREATE UNIQUE INDEX "Payment_verificationCodeHash_key" ON "Payment"("verificationCodeHash");
CREATE INDEX "Payment_status_method_idx" ON "Payment"("status", "method");
CREATE INDEX "Payment_confirmedAt_idx" ON "Payment"("confirmedAt");
CREATE INDEX "Payment_codeExpiresAt_idx" ON "Payment"("codeExpiresAt");
CREATE INDEX "Payment_confirmedClinicId_idx" ON "Payment"("confirmedClinicId");
CREATE INDEX "PaymentEvent_paymentId_createdAt_idx" ON "PaymentEvent"("paymentId", "createdAt");
CREATE INDEX "PaymentEvent_eventType_createdAt_idx" ON "PaymentEvent"("eventType", "createdAt");
CREATE INDEX "PaymentEvent_actorUserId_createdAt_idx" ON "PaymentEvent"("actorUserId", "createdAt");
CREATE UNIQUE INDEX "PaymentIdempotencyKey_key_scope_userId_key" ON "PaymentIdempotencyKey"("key", "scope", "userId");
CREATE INDEX "PaymentIdempotencyKey_paymentId_createdAt_idx" ON "PaymentIdempotencyKey"("paymentId", "createdAt");
CREATE INDEX "PaymentVerificationAttempt_actorUserId_createdAt_idx" ON "PaymentVerificationAttempt"("actorUserId", "createdAt");
CREATE INDEX "PaymentVerificationAttempt_ipHash_createdAt_idx" ON "PaymentVerificationAttempt"("ipHash", "createdAt");
CREATE INDEX "PaymentVerificationAttempt_paymentId_createdAt_idx" ON "PaymentVerificationAttempt"("paymentId", "createdAt");

ALTER TABLE "Payment" ADD CONSTRAINT "Payment_appointmentId_fkey" FOREIGN KEY ("appointmentId") REFERENCES "Appointment"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Payment" ADD CONSTRAINT "Payment_confirmedByUserId_fkey" FOREIGN KEY ("confirmedByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "Payment" ADD CONSTRAINT "Payment_confirmedClinicId_fkey" FOREIGN KEY ("confirmedClinicId") REFERENCES "ClinicProfile"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "PaymentEvent" ADD CONSTRAINT "PaymentEvent_paymentId_fkey" FOREIGN KEY ("paymentId") REFERENCES "Payment"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "PaymentEvent" ADD CONSTRAINT "PaymentEvent_actorUserId_fkey" FOREIGN KEY ("actorUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "PaymentEvent" ADD CONSTRAINT "PaymentEvent_clinicId_fkey" FOREIGN KEY ("clinicId") REFERENCES "ClinicProfile"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "PaymentIdempotencyKey" ADD CONSTRAINT "PaymentIdempotencyKey_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "PaymentIdempotencyKey" ADD CONSTRAINT "PaymentIdempotencyKey_paymentId_fkey" FOREIGN KEY ("paymentId") REFERENCES "Payment"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "PaymentVerificationAttempt" ADD CONSTRAINT "PaymentVerificationAttempt_paymentId_fkey" FOREIGN KEY ("paymentId") REFERENCES "Payment"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "PaymentVerificationAttempt" ADD CONSTRAINT "PaymentVerificationAttempt_actorUserId_fkey" FOREIGN KEY ("actorUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE UNIQUE INDEX "Payment_one_confirmed_event" ON "PaymentEvent"("paymentId") WHERE "eventType" = 'CONFIRMED';
