CREATE TYPE "CertificationStatus" AS ENUM ('DRAFT', 'PENDING_REVIEW', 'APPROVED', 'REJECTED', 'EXPIRED');

ALTER TABLE "Certification"
ADD COLUMN "credentialNumber" TEXT,
ADD COLUMN "issuedAt" DATE,
ADD COLUMN "expiresAt" DATE,
ADD COLUMN "documentUrl" TEXT,
ADD COLUMN "documentPublicId" TEXT,
ADD COLUMN "documentMimeType" TEXT,
ADD COLUMN "documentSizeBytes" INTEGER,
ADD COLUMN "documentFormat" TEXT,
ADD COLUMN "status" "CertificationStatus" NOT NULL DEFAULT 'DRAFT',
ADD COLUMN "rejectionReason" TEXT,
ADD COLUMN "submittedAt" TIMESTAMPTZ(3),
ADD COLUMN "reviewedAt" TIMESTAMPTZ(3),
ADD COLUMN "reviewedByUserId" TEXT,
ADD COLUMN "deletedAt" TIMESTAMPTZ(3);

UPDATE "Certification"
SET "issuedAt" = make_date("year", 1, 1)
WHERE "year" IS NOT NULL AND "year" BETWEEN 1 AND 9999;

ALTER TABLE "Certification"
ADD CONSTRAINT "Certification_reviewedByUserId_fkey"
FOREIGN KEY ("reviewedByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

DROP INDEX IF EXISTS "Certification_doctorProfileId_idx";
CREATE INDEX "Certification_doctorProfileId_status_idx" ON "Certification"("doctorProfileId", "status");
CREATE INDEX "Certification_reviewedByUserId_idx" ON "Certification"("reviewedByUserId");
CREATE INDEX "Certification_deletedAt_idx" ON "Certification"("deletedAt");

CREATE TABLE "CertificationAuditLog" (
  "id" TEXT NOT NULL,
  "certificationId" TEXT NOT NULL,
  "actorUserId" TEXT,
  "action" TEXT NOT NULL,
  "reason" TEXT,
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "CertificationAuditLog_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "CertificationAuditLog"
ADD CONSTRAINT "CertificationAuditLog_certificationId_fkey"
FOREIGN KEY ("certificationId") REFERENCES "Certification"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "CertificationAuditLog"
ADD CONSTRAINT "CertificationAuditLog_actorUserId_fkey"
FOREIGN KEY ("actorUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE INDEX "CertificationAuditLog_certificationId_createdAt_idx" ON "CertificationAuditLog"("certificationId", "createdAt");
CREATE INDEX "CertificationAuditLog_actorUserId_idx" ON "CertificationAuditLog"("actorUserId");
