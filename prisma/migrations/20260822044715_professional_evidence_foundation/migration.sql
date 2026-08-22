/*
  Warnings:

  - A unique constraint covering the columns `[id,credentialId]` on the table `CredentialDocument` will be added. If there are existing duplicate values, this will fail.
  - A unique constraint covering the columns `[id,userId]` on the table `ProfessionalApplication` will be added. If there are existing duplicate values, this will fail.
  - A unique constraint covering the columns `[id,applicationId,credentialId]` on the table `ProfessionalApplicationCredential` will be added. If there are existing duplicate values, this will fail.
  - A unique constraint covering the columns `[id,applicationId,revision]` on the table `ProfessionalApplicationSnapshot` will be added. If there are existing duplicate values, this will fail.
  - A unique constraint covering the columns `[id,userId]` on the table `ProfessionalCredential` will be added. If there are existing duplicate values, this will fail.

*/
-- CreateEnum
CREATE TYPE "ProfessionalEvidenceCaptureSource" AS ENUM ('LIVE_SUBMIT', 'BACKFILL_V1');

-- CreateEnum
CREATE TYPE "ProfessionalEvidenceRetentionStatus" AS ENUM ('HELD', 'RELEASE_ELIGIBLE', 'RELEASED');

-- CreateEnum
CREATE TYPE "ProfessionalEvidenceBinaryStatus" AS ENUM ('PRESENT', 'UNKNOWN', 'MISSING', 'PURGE_PENDING', 'PURGED', 'PURGE_FAILED');

-- CreateEnum
CREATE TYPE "ProfessionalEvidenceRetentionAction" AS ENUM ('HOLD_CREATED', 'DELETE_REQUESTED', 'MARKED_RELEASE_ELIGIBLE', 'HOLD_RELEASED', 'BINARY_MARKED_MISSING', 'PURGE_SCHEDULED', 'PURGE_SUCCEEDED', 'PURGE_FAILED');

-- AlterTable
ALTER TABLE "CredentialDocument" ADD COLUMN     "height" INTEGER,
ADD COLUMN     "width" INTEGER;

-- CreateTable
CREATE TABLE "ProfessionalApplicationCredentialDocumentEvidence" (
    "id" UUID NOT NULL,
    "applicationId" TEXT NOT NULL,
    "applicantUserId" TEXT NOT NULL,
    "snapshotId" TEXT NOT NULL,
    "snapshotRevision" INTEGER NOT NULL,
    "applicationCredentialId" TEXT NOT NULL,
    "credentialId" TEXT NOT NULL,
    "credentialDocumentId" TEXT NOT NULL,
    "evidenceType" "CredentialDocumentKind" NOT NULL,
    "mimeType" VARCHAR(100) NOT NULL,
    "format" VARCHAR(20) NOT NULL,
    "resourceType" VARCHAR(20) NOT NULL,
    "sizeBytes" INTEGER NOT NULL,
    "pageCount" INTEGER,
    "width" INTEGER,
    "height" INTEGER,
    "checksumSha256" CHAR(64) NOT NULL,
    "scanStatusAtSubmit" "DocumentScanStatus" NOT NULL,
    "captureSource" "ProfessionalEvidenceCaptureSource" NOT NULL,
    "includedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ProfessionalApplicationCredentialDocumentEvidence_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProfessionalEvidenceRetention" (
    "evidenceId" UUID NOT NULL,
    "status" "ProfessionalEvidenceRetentionStatus" NOT NULL DEFAULT 'HELD',
    "retentionHoldUntil" TIMESTAMPTZ(3),
    "deleteRequestedAt" TIMESTAMPTZ(3),
    "releaseEligibleAt" TIMESTAMPTZ(3),
    "releasedAt" TIMESTAMPTZ(3),
    "releaseReasonCode" VARCHAR(80),
    "binaryStatus" "ProfessionalEvidenceBinaryStatus" NOT NULL DEFAULT 'PRESENT',
    "lastStorageCheckAt" TIMESTAMPTZ(3),
    "updatedByUserId" TEXT,
    "version" INTEGER NOT NULL DEFAULT 1,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "ProfessionalEvidenceRetention_pkey" PRIMARY KEY ("evidenceId")
);

-- CreateTable
CREATE TABLE "ProfessionalEvidenceRetentionEvent" (
    "id" UUID NOT NULL,
    "evidenceId" UUID NOT NULL,
    "actorUserId" TEXT,
    "action" "ProfessionalEvidenceRetentionAction" NOT NULL,
    "previousStatus" "ProfessionalEvidenceRetentionStatus",
    "newStatus" "ProfessionalEvidenceRetentionStatus" NOT NULL,
    "reasonCode" VARCHAR(80),
    "requestId" VARCHAR(120),
    "idempotencyKey" VARCHAR(120),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ProfessionalEvidenceRetentionEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ProfessionalApplicationCredentialDocumentEvidence_applicati_idx" ON "ProfessionalApplicationCredentialDocumentEvidence"("applicationId", "includedAt");

-- CreateIndex
CREATE INDEX "ProfessionalApplicationCredentialDocumentEvidence_applicant_idx" ON "ProfessionalApplicationCredentialDocumentEvidence"("applicantUserId", "includedAt");

-- CreateIndex
CREATE INDEX "PAEvidence_credential_included_idx" ON "ProfessionalApplicationCredentialDocumentEvidence"("credentialId", "includedAt");

-- CreateIndex
CREATE INDEX "PAEvidence_document_idx" ON "ProfessionalApplicationCredentialDocumentEvidence"("credentialDocumentId");

-- CreateIndex
CREATE INDEX "ProfessionalApplicationCredentialDocumentEvidence_snapshotI_idx" ON "ProfessionalApplicationCredentialDocumentEvidence"("snapshotId", "snapshotRevision");

-- CreateIndex
CREATE UNIQUE INDEX "ProfessionalApplicationCredentialDocumentEvidence_snapshotI_key" ON "ProfessionalApplicationCredentialDocumentEvidence"("snapshotId", "credentialDocumentId");

-- CreateIndex
CREATE INDEX "ProfessionalEvidenceRetention_status_retentionHoldUntil_idx" ON "ProfessionalEvidenceRetention"("status", "retentionHoldUntil");

-- CreateIndex
CREATE INDEX "ProfessionalEvidenceRetention_binaryStatus_lastStorageCheck_idx" ON "ProfessionalEvidenceRetention"("binaryStatus", "lastStorageCheckAt");

-- CreateIndex
CREATE INDEX "ProfessionalEvidenceRetention_updatedByUserId_updatedAt_idx" ON "ProfessionalEvidenceRetention"("updatedByUserId", "updatedAt");

-- CreateIndex
CREATE UNIQUE INDEX "ProfessionalEvidenceRetentionEvent_idempotencyKey_key" ON "ProfessionalEvidenceRetentionEvent"("idempotencyKey");

-- CreateIndex
CREATE INDEX "ProfessionalEvidenceRetentionEvent_evidenceId_createdAt_idx" ON "ProfessionalEvidenceRetentionEvent"("evidenceId", "createdAt");

-- CreateIndex
CREATE INDEX "ProfessionalEvidenceRetentionEvent_actorUserId_createdAt_idx" ON "ProfessionalEvidenceRetentionEvent"("actorUserId", "createdAt");

-- CreateIndex
CREATE INDEX "ProfessionalEvidenceRetentionEvent_action_createdAt_idx" ON "ProfessionalEvidenceRetentionEvent"("action", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "CredentialDocument_id_credentialId_key" ON "CredentialDocument"("id", "credentialId");

-- CreateIndex
CREATE UNIQUE INDEX "ProfessionalApplication_id_userId_key" ON "ProfessionalApplication"("id", "userId");

-- CreateIndex
CREATE UNIQUE INDEX "ProfessionalApplicationCredential_id_applicationId_credenti_key" ON "ProfessionalApplicationCredential"("id", "applicationId", "credentialId");

-- CreateIndex
CREATE UNIQUE INDEX "ProfessionalApplicationSnapshot_id_applicationId_revision_key" ON "ProfessionalApplicationSnapshot"("id", "applicationId", "revision");

-- CreateIndex
CREATE UNIQUE INDEX "ProfessionalCredential_id_userId_key" ON "ProfessionalCredential"("id", "userId");

-- AddForeignKey
ALTER TABLE "ProfessionalApplicationCredentialDocumentEvidence" ADD CONSTRAINT "PAEvidence_application_applicant_fkey" FOREIGN KEY ("applicationId", "applicantUserId") REFERENCES "ProfessionalApplication"("id", "userId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProfessionalApplicationCredentialDocumentEvidence" ADD CONSTRAINT "PAEvidence_snapshot_revision_fkey" FOREIGN KEY ("snapshotId", "applicationId", "snapshotRevision") REFERENCES "ProfessionalApplicationSnapshot"("id", "applicationId", "revision") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProfessionalApplicationCredentialDocumentEvidence" ADD CONSTRAINT "PAEvidence_application_credential_fkey" FOREIGN KEY ("applicationCredentialId", "applicationId", "credentialId") REFERENCES "ProfessionalApplicationCredential"("id", "applicationId", "credentialId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProfessionalApplicationCredentialDocumentEvidence" ADD CONSTRAINT "PAEvidence_credential_applicant_fkey" FOREIGN KEY ("credentialId", "applicantUserId") REFERENCES "ProfessionalCredential"("id", "userId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProfessionalApplicationCredentialDocumentEvidence" ADD CONSTRAINT "PAEvidence_document_credential_fkey" FOREIGN KEY ("credentialDocumentId", "credentialId") REFERENCES "CredentialDocument"("id", "credentialId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProfessionalEvidenceRetention" ADD CONSTRAINT "ProfessionalEvidenceRetention_evidenceId_fkey" FOREIGN KEY ("evidenceId") REFERENCES "ProfessionalApplicationCredentialDocumentEvidence"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProfessionalEvidenceRetention" ADD CONSTRAINT "ProfessionalEvidenceRetention_updatedByUserId_fkey" FOREIGN KEY ("updatedByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProfessionalEvidenceRetentionEvent" ADD CONSTRAINT "ProfessionalEvidenceRetentionEvent_evidenceId_fkey" FOREIGN KEY ("evidenceId") REFERENCES "ProfessionalApplicationCredentialDocumentEvidence"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProfessionalEvidenceRetentionEvent" ADD CONSTRAINT "ProfessionalEvidenceRetentionEvent_actorUserId_fkey" FOREIGN KEY ("actorUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Evidence metadata must be internally consistent before it can become an
-- immutable historical record. PENDING is deliberately accepted here: scan
-- policy belongs to the future administrative review phase, not this schema.
ALTER TABLE "ProfessionalApplicationCredentialDocumentEvidence"
  ADD CONSTRAINT "PAEvidence_snapshot_revision_positive"
    CHECK ("snapshotRevision" > 0),
  ADD CONSTRAINT "PAEvidence_size_positive"
    CHECK ("sizeBytes" > 0),
  ADD CONSTRAINT "PAEvidence_page_count_positive"
    CHECK ("pageCount" IS NULL OR "pageCount" > 0),
  ADD CONSTRAINT "PAEvidence_dimensions_consistent"
    CHECK (
      num_nonnulls("width", "height") = 0
      OR (num_nonnulls("width", "height") = 2 AND "width" > 0 AND "height" > 0)
    ),
  ADD CONSTRAINT "PAEvidence_checksum_sha256"
    CHECK ("checksumSha256" ~ '^[0-9a-f]{64}$');

ALTER TABLE "CredentialDocument"
  ADD CONSTRAINT "CredentialDocument_dimensions_consistent"
    CHECK (
      num_nonnulls("width", "height") = 0
      OR (num_nonnulls("width", "height") = 2 AND "width" > 0 AND "height" > 0)
    );

ALTER TABLE "ProfessionalEvidenceRetention"
  ADD CONSTRAINT "ProfessionalEvidenceRetention_version_positive"
    CHECK ("version" > 0),
  ADD CONSTRAINT "ProfessionalEvidenceRetention_status_timestamps"
    CHECK (
      ("status" = 'HELD' AND "releaseEligibleAt" IS NULL AND "releasedAt" IS NULL)
      OR
      ("status" = 'RELEASE_ELIGIBLE' AND "releaseEligibleAt" IS NOT NULL AND "releasedAt" IS NULL)
      OR
      ("status" = 'RELEASED' AND "releaseEligibleAt" IS NOT NULL AND "releasedAt" IS NOT NULL)
    ),
  ADD CONSTRAINT "ProfessionalEvidenceRetention_chronology"
    CHECK (
      ("deleteRequestedAt" IS NULL OR "releaseEligibleAt" IS NULL OR "releaseEligibleAt" >= "deleteRequestedAt")
      AND
      ("releaseEligibleAt" IS NULL OR "releasedAt" IS NULL OR "releasedAt" >= "releaseEligibleAt")
    );

-- Historical rows are append-only at the database boundary. This is stronger
-- than relying on ORM conventions or application-role permissions alone.
CREATE FUNCTION "zenda_reject_professional_append_only_mutation"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'Zenda historical record is append-only: %', TG_TABLE_NAME
    USING ERRCODE = '55000';
END;
$$;

CREATE TRIGGER "PAEvidence_reject_update_delete"
BEFORE UPDATE OR DELETE ON "ProfessionalApplicationCredentialDocumentEvidence"
FOR EACH ROW EXECUTE FUNCTION "zenda_reject_professional_append_only_mutation"();

CREATE TRIGGER "ProfessionalApplicationSnapshot_reject_update_delete"
BEFORE UPDATE OR DELETE ON "ProfessionalApplicationSnapshot"
FOR EACH ROW EXECUTE FUNCTION "zenda_reject_professional_append_only_mutation"();

CREATE TRIGGER "ProfessionalApplicationReviewLog_reject_update_delete"
BEFORE UPDATE OR DELETE ON "ProfessionalApplicationReviewLog"
FOR EACH ROW EXECUTE FUNCTION "zenda_reject_professional_append_only_mutation"();

CREATE TRIGGER "ProfessionalEvidenceRetentionEvent_reject_update_delete"
BEFORE UPDATE OR DELETE ON "ProfessionalEvidenceRetentionEvent"
FOR EACH ROW EXECUTE FUNCTION "zenda_reject_professional_append_only_mutation"();

-- Once a document participates in immutable evidence, only operational state
-- may evolve: scanStatus/scannedAt, soft deletion and Prisma's updatedAt.
-- Storage identity and the metadata frozen in evidence can no longer drift.
CREATE FUNCTION "zenda_protect_evidenced_credential_document"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM "ProfessionalApplicationCredentialDocumentEvidence" evidence
    WHERE evidence."credentialDocumentId" = OLD."id"
  ) AND (
    NEW."id" IS DISTINCT FROM OLD."id"
    OR NEW."credentialId" IS DISTINCT FROM OLD."credentialId"
    OR NEW."kind" IS DISTINCT FROM OLD."kind"
    OR NEW."storageProvider" IS DISTINCT FROM OLD."storageProvider"
    OR NEW."publicId" IS DISTINCT FROM OLD."publicId"
    OR NEW."resourceType" IS DISTINCT FROM OLD."resourceType"
    OR NEW."format" IS DISTINCT FROM OLD."format"
    OR NEW."mimeType" IS DISTINCT FROM OLD."mimeType"
    OR NEW."sizeBytes" IS DISTINCT FROM OLD."sizeBytes"
    OR NEW."checksumSha256" IS DISTINCT FROM OLD."checksumSha256"
    OR NEW."pageCount" IS DISTINCT FROM OLD."pageCount"
    OR NEW."width" IS DISTINCT FROM OLD."width"
    OR NEW."height" IS DISTINCT FROM OLD."height"
    OR NEW."createdAt" IS DISTINCT FROM OLD."createdAt"
  ) THEN
    RAISE EXCEPTION 'CredentialDocument immutable evidence metadata cannot change'
      USING ERRCODE = '55000';
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER "CredentialDocument_protect_evidenced_metadata"
BEFORE UPDATE ON "CredentialDocument"
FOR EACH ROW EXECUTE FUNCTION "zenda_protect_evidenced_credential_document"();
