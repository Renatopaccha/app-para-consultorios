-- CreateEnum
CREATE TYPE "ProfessionalApplicationStatus" AS ENUM ('DRAFT', 'PENDING_REVIEW', 'NEEDS_CHANGES', 'APPROVED', 'REJECTED');

-- CreateEnum
CREATE TYPE "ProfessionalCredentialType" AS ENUM ('PRIMARY_DEGREE', 'SPECIALTY', 'SUBSPECIALTY', 'MASTER', 'PHD', 'OTHER_RELEVANT');

-- CreateEnum
CREATE TYPE "CredentialOwnershipStatus" AS ENUM ('CLAIMED', 'DISPUTED', 'RELEASED');

-- CreateEnum
CREATE TYPE "CredentialVerificationStatus" AS ENUM ('UNVERIFIED', 'PENDING', 'VERIFIED', 'REJECTED');

-- CreateEnum
CREATE TYPE "CredentialDocumentKind" AS ENUM ('PRIMARY_EVIDENCE', 'SUPPORTING_EVIDENCE');

-- CreateEnum
CREATE TYPE "DocumentScanStatus" AS ENUM ('PENDING', 'CLEAN', 'REJECTED', 'ERROR');

-- CreateEnum
CREATE TYPE "ApplicationAssetCategory" AS ENUM ('AVATAR', 'PRACTICE_INTERIOR', 'PRACTICE_EXTERIOR');

-- CreateEnum
CREATE TYPE "ApplicationAssetModerationStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED');

-- CreateEnum
CREATE TYPE "LocationPrecision" AS ENUM ('EXACT', 'APPROXIMATE', 'CITY');

-- CreateEnum
CREATE TYPE "ProfessionalApplicationReviewAction" AS ENUM ('SUBMITTED', 'CHANGES_REQUESTED', 'RESUBMITTED', 'APPROVED', 'REJECTED', 'REOPENED');

-- CreateEnum
CREATE TYPE "RegulatoryDocumentType" AS ENUM ('NATIONAL_ID', 'PASSPORT', 'OTHER');

-- CreateEnum
CREATE TYPE "RegulatoryIdentityVerificationStatus" AS ENUM ('UNVERIFIED', 'PENDING', 'VERIFIED', 'REJECTED');

-- CreateTable
CREATE TABLE "ProfessionalApplication" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "cycleNumber" INTEGER NOT NULL,
    "status" "ProfessionalApplicationStatus" NOT NULL DEFAULT 'DRAFT',
    "healthProfessionId" TEXT,
    "legalGivenNames" VARCHAR(160),
    "legalFamilyNames" VARCHAR(160),
    "primaryPhoneE164" VARCHAR(20),
    "alternatePhoneE164" VARCHAR(20),
    "practiceCountryCode" CHAR(2),
    "publicBio" VARCHAR(1000),
    "currentRevision" INTEGER NOT NULL DEFAULT 1,
    "lastVisitedStep" INTEGER NOT NULL DEFAULT 1,
    "submittedAt" TIMESTAMPTZ(3),
    "decidedAt" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "ProfessionalApplication_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProfessionalApplicationSpecialty" (
    "id" TEXT NOT NULL,
    "applicationId" TEXT NOT NULL,
    "specialtyId" TEXT NOT NULL,
    "isPrimary" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ProfessionalApplicationSpecialty_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProfessionalCredential" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "credentialType" "ProfessionalCredentialType" NOT NULL,
    "countryCode" CHAR(2) NOT NULL,
    "exactTitle" VARCHAR(200) NOT NULL,
    "institutionId" TEXT,
    "institutionNameSnapshot" VARCHAR(180) NOT NULL,
    "registrationAuthorityId" TEXT,
    "authorityNameSnapshot" VARCHAR(180),
    "registrationNumberOriginal" VARCHAR(120),
    "registrationNumberNormalized" VARCHAR(120),
    "issuedAt" DATE,
    "expiresAt" DATE,
    "ownershipStatus" "CredentialOwnershipStatus" NOT NULL DEFAULT 'CLAIMED',
    "verificationStatus" "CredentialVerificationStatus" NOT NULL DEFAULT 'UNVERIFIED',
    "verifiedAt" TIMESTAMPTZ(3),
    "verifiedByUserId" TEXT,
    "verificationSource" VARCHAR(200),
    "deletedAt" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "ProfessionalCredential_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProfessionalApplicationCredential" (
    "id" TEXT NOT NULL,
    "applicationId" TEXT NOT NULL,
    "credentialId" TEXT NOT NULL,
    "isPrimary" BOOLEAN NOT NULL DEFAULT false,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ProfessionalApplicationCredential_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CredentialDocument" (
    "id" TEXT NOT NULL,
    "credentialId" TEXT NOT NULL,
    "kind" "CredentialDocumentKind" NOT NULL DEFAULT 'PRIMARY_EVIDENCE',
    "storageProvider" VARCHAR(40) NOT NULL,
    "publicId" VARCHAR(500) NOT NULL,
    "resourceType" VARCHAR(20) NOT NULL,
    "format" VARCHAR(20) NOT NULL,
    "mimeType" VARCHAR(100) NOT NULL,
    "sizeBytes" INTEGER NOT NULL,
    "checksumSha256" CHAR(64) NOT NULL,
    "pageCount" INTEGER,
    "scanStatus" "DocumentScanStatus" NOT NULL DEFAULT 'PENDING',
    "scannedAt" TIMESTAMPTZ(3),
    "deletedAt" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "CredentialDocument_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProfessionalApplicationLocation" (
    "id" TEXT NOT NULL,
    "applicationId" TEXT NOT NULL,
    "name" VARCHAR(160),
    "countryCode" CHAR(2),
    "administrativeArea1" VARCHAR(120),
    "administrativeArea2" VARCHAR(120),
    "city" VARCHAR(120),
    "street1" VARCHAR(200),
    "street2" VARCHAR(200),
    "reference" VARCHAR(300),
    "postalCode" VARCHAR(20),
    "floorNumber" INTEGER,
    "officeLabel" VARCHAR(40),
    "instructions" VARCHAR(500),
    "latitude" DECIMAL(9,6),
    "longitude" DECIMAL(9,6),
    "locationPrecision" "LocationPrecision" NOT NULL DEFAULT 'APPROXIMATE',
    "providerType" VARCHAR(40),
    "providerPlaceId" VARCHAR(500),
    "confirmedAt" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "ProfessionalApplicationLocation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProfessionalApplicationLanguage" (
    "id" TEXT NOT NULL,
    "applicationId" TEXT NOT NULL,
    "languageId" TEXT NOT NULL,
    "proficiency" VARCHAR(40),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ProfessionalApplicationLanguage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProfessionalApplicationAsset" (
    "id" TEXT NOT NULL,
    "applicationId" TEXT NOT NULL,
    "category" "ApplicationAssetCategory" NOT NULL,
    "storageProvider" VARCHAR(40) NOT NULL,
    "publicId" VARCHAR(500) NOT NULL,
    "resourceType" VARCHAR(20) NOT NULL,
    "format" VARCHAR(20) NOT NULL,
    "mimeType" VARCHAR(100) NOT NULL,
    "sizeBytes" INTEGER NOT NULL,
    "width" INTEGER NOT NULL,
    "height" INTEGER NOT NULL,
    "checksumSha256" CHAR(64) NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "moderationStatus" "ApplicationAssetModerationStatus" NOT NULL DEFAULT 'PENDING',
    "deletedAt" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "ProfessionalApplicationAsset_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProfessionalApplicationSnapshot" (
    "id" TEXT NOT NULL,
    "applicationId" TEXT NOT NULL,
    "revision" INTEGER NOT NULL,
    "schemaVersion" INTEGER NOT NULL,
    "payload" JSONB NOT NULL,
    "payloadHash" CHAR(64) NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ProfessionalApplicationSnapshot_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProfessionalApplicationReviewLog" (
    "id" TEXT NOT NULL,
    "applicationId" TEXT NOT NULL,
    "snapshotId" TEXT,
    "actorUserId" TEXT,
    "action" "ProfessionalApplicationReviewAction" NOT NULL,
    "previousStatus" "ProfessionalApplicationStatus",
    "newStatus" "ProfessionalApplicationStatus" NOT NULL,
    "reasonCode" VARCHAR(80),
    "applicantMessage" VARCHAR(1000),
    "internalNote" VARCHAR(2000),
    "changedSections" JSONB,
    "idempotencyKey" VARCHAR(120),
    "requestId" VARCHAR(120),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ProfessionalApplicationReviewLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProfessionalRegulatoryIdentity" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "applicationId" TEXT,
    "countryCode" CHAR(2) NOT NULL,
    "authorityNamespace" VARCHAR(100) NOT NULL,
    "documentType" "RegulatoryDocumentType" NOT NULL,
    "documentNumberCiphertext" TEXT NOT NULL,
    "documentNumberFingerprint" CHAR(64) NOT NULL,
    "encryptionKeyVersion" INTEGER NOT NULL,
    "normalizationVersion" INTEGER NOT NULL DEFAULT 1,
    "verificationStatus" "RegulatoryIdentityVerificationStatus" NOT NULL DEFAULT 'UNVERIFIED',
    "verifiedAt" TIMESTAMPTZ(3),
    "verifiedByUserId" TEXT,
    "deletedAt" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "ProfessionalRegulatoryIdentity_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ProfessionalApplication_userId_status_idx" ON "ProfessionalApplication"("userId", "status");

-- CreateIndex
CREATE INDEX "ProfessionalApplication_status_submittedAt_createdAt_idx" ON "ProfessionalApplication"("status", "submittedAt", "createdAt");

-- CreateIndex
CREATE INDEX "ProfessionalApplication_healthProfessionId_status_idx" ON "ProfessionalApplication"("healthProfessionId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "ProfessionalApplication_userId_cycleNumber_key" ON "ProfessionalApplication"("userId", "cycleNumber");

-- CreateIndex
CREATE INDEX "ProfessionalApplicationSpecialty_specialtyId_idx" ON "ProfessionalApplicationSpecialty"("specialtyId");

-- CreateIndex
CREATE UNIQUE INDEX "ProfessionalApplicationSpecialty_applicationId_specialtyId_key" ON "ProfessionalApplicationSpecialty"("applicationId", "specialtyId");

-- CreateIndex
CREATE INDEX "ProfessionalCredential_userId_deletedAt_idx" ON "ProfessionalCredential"("userId", "deletedAt");

-- CreateIndex
CREATE INDEX "ProfessionalCredential_registrationAuthorityId_registration_idx" ON "ProfessionalCredential"("registrationAuthorityId", "registrationNumberNormalized");

-- CreateIndex
CREATE INDEX "ProfessionalCredential_verificationStatus_createdAt_idx" ON "ProfessionalCredential"("verificationStatus", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "ProfessionalCredential_registry_identity_key" ON "ProfessionalCredential"("countryCode", "registrationAuthorityId", "registrationNumberNormalized");

-- CreateIndex
CREATE INDEX "ProfessionalApplicationCredential_credentialId_idx" ON "ProfessionalApplicationCredential"("credentialId");

-- CreateIndex
CREATE UNIQUE INDEX "ProfessionalApplicationCredential_applicationId_credentialI_key" ON "ProfessionalApplicationCredential"("applicationId", "credentialId");

-- CreateIndex
CREATE INDEX "CredentialDocument_credentialId_deletedAt_idx" ON "CredentialDocument"("credentialId", "deletedAt");

-- CreateIndex
CREATE INDEX "CredentialDocument_scanStatus_createdAt_idx" ON "CredentialDocument"("scanStatus", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "CredentialDocument_storageProvider_publicId_key" ON "CredentialDocument"("storageProvider", "publicId");

-- CreateIndex
CREATE UNIQUE INDEX "ProfessionalApplicationLocation_applicationId_key" ON "ProfessionalApplicationLocation"("applicationId");

-- CreateIndex
CREATE INDEX "ProfessionalApplicationLocation_countryCode_administrativeA_idx" ON "ProfessionalApplicationLocation"("countryCode", "administrativeArea1", "city");

-- CreateIndex
CREATE INDEX "ProfessionalApplicationLocation_latitude_longitude_idx" ON "ProfessionalApplicationLocation"("latitude", "longitude");

-- CreateIndex
CREATE INDEX "ProfessionalApplicationLanguage_languageId_idx" ON "ProfessionalApplicationLanguage"("languageId");

-- CreateIndex
CREATE UNIQUE INDEX "ProfessionalApplicationLanguage_applicationId_languageId_key" ON "ProfessionalApplicationLanguage"("applicationId", "languageId");

-- CreateIndex
CREATE INDEX "ProfessionalApplicationAsset_applicationId_category_sortOrd_idx" ON "ProfessionalApplicationAsset"("applicationId", "category", "sortOrder");

-- CreateIndex
CREATE INDEX "ProfessionalApplicationAsset_applicationId_deletedAt_idx" ON "ProfessionalApplicationAsset"("applicationId", "deletedAt");

-- CreateIndex
CREATE INDEX "ProfessionalApplicationAsset_moderationStatus_createdAt_idx" ON "ProfessionalApplicationAsset"("moderationStatus", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "ProfessionalApplicationAsset_storageProvider_publicId_key" ON "ProfessionalApplicationAsset"("storageProvider", "publicId");

-- CreateIndex
CREATE INDEX "ProfessionalApplicationSnapshot_applicationId_createdAt_idx" ON "ProfessionalApplicationSnapshot"("applicationId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "ProfessionalApplicationSnapshot_applicationId_revision_key" ON "ProfessionalApplicationSnapshot"("applicationId", "revision");

-- CreateIndex
CREATE UNIQUE INDEX "ProfessionalApplicationReviewLog_idempotencyKey_key" ON "ProfessionalApplicationReviewLog"("idempotencyKey");

-- CreateIndex
CREATE INDEX "ProfessionalApplicationReviewLog_applicationId_createdAt_idx" ON "ProfessionalApplicationReviewLog"("applicationId", "createdAt");

-- CreateIndex
CREATE INDEX "ProfessionalApplicationReviewLog_newStatus_createdAt_idx" ON "ProfessionalApplicationReviewLog"("newStatus", "createdAt");

-- CreateIndex
CREATE INDEX "ProfessionalApplicationReviewLog_actorUserId_createdAt_idx" ON "ProfessionalApplicationReviewLog"("actorUserId", "createdAt");

-- CreateIndex
CREATE INDEX "ProfessionalRegulatoryIdentity_userId_deletedAt_idx" ON "ProfessionalRegulatoryIdentity"("userId", "deletedAt");

-- CreateIndex
CREATE INDEX "ProfessionalRegulatoryIdentity_applicationId_idx" ON "ProfessionalRegulatoryIdentity"("applicationId");

-- CreateIndex
CREATE INDEX "ProfessionalRegulatoryIdentity_verificationStatus_createdAt_idx" ON "ProfessionalRegulatoryIdentity"("verificationStatus", "createdAt");

-- AddForeignKey
ALTER TABLE "ProfessionalApplication" ADD CONSTRAINT "ProfessionalApplication_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProfessionalApplication" ADD CONSTRAINT "ProfessionalApplication_healthProfessionId_fkey" FOREIGN KEY ("healthProfessionId") REFERENCES "HealthProfession"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProfessionalApplicationSpecialty" ADD CONSTRAINT "ProfessionalApplicationSpecialty_applicationId_fkey" FOREIGN KEY ("applicationId") REFERENCES "ProfessionalApplication"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProfessionalApplicationSpecialty" ADD CONSTRAINT "ProfessionalApplicationSpecialty_specialtyId_fkey" FOREIGN KEY ("specialtyId") REFERENCES "Specialty"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProfessionalCredential" ADD CONSTRAINT "ProfessionalCredential_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProfessionalCredential" ADD CONSTRAINT "ProfessionalCredential_institutionId_fkey" FOREIGN KEY ("institutionId") REFERENCES "Institution"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProfessionalCredential" ADD CONSTRAINT "ProfessionalCredential_registrationAuthorityId_fkey" FOREIGN KEY ("registrationAuthorityId") REFERENCES "RegistrationAuthority"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProfessionalCredential" ADD CONSTRAINT "ProfessionalCredential_verifiedByUserId_fkey" FOREIGN KEY ("verifiedByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProfessionalApplicationCredential" ADD CONSTRAINT "ProfessionalApplicationCredential_applicationId_fkey" FOREIGN KEY ("applicationId") REFERENCES "ProfessionalApplication"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProfessionalApplicationCredential" ADD CONSTRAINT "ProfessionalApplicationCredential_credentialId_fkey" FOREIGN KEY ("credentialId") REFERENCES "ProfessionalCredential"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CredentialDocument" ADD CONSTRAINT "CredentialDocument_credentialId_fkey" FOREIGN KEY ("credentialId") REFERENCES "ProfessionalCredential"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProfessionalApplicationLocation" ADD CONSTRAINT "ProfessionalApplicationLocation_applicationId_fkey" FOREIGN KEY ("applicationId") REFERENCES "ProfessionalApplication"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProfessionalApplicationLanguage" ADD CONSTRAINT "ProfessionalApplicationLanguage_applicationId_fkey" FOREIGN KEY ("applicationId") REFERENCES "ProfessionalApplication"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProfessionalApplicationLanguage" ADD CONSTRAINT "ProfessionalApplicationLanguage_languageId_fkey" FOREIGN KEY ("languageId") REFERENCES "Language"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProfessionalApplicationAsset" ADD CONSTRAINT "ProfessionalApplicationAsset_applicationId_fkey" FOREIGN KEY ("applicationId") REFERENCES "ProfessionalApplication"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProfessionalApplicationSnapshot" ADD CONSTRAINT "ProfessionalApplicationSnapshot_applicationId_fkey" FOREIGN KEY ("applicationId") REFERENCES "ProfessionalApplication"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProfessionalApplicationReviewLog" ADD CONSTRAINT "ProfessionalApplicationReviewLog_applicationId_fkey" FOREIGN KEY ("applicationId") REFERENCES "ProfessionalApplication"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProfessionalApplicationReviewLog" ADD CONSTRAINT "ProfessionalApplicationReviewLog_snapshotId_fkey" FOREIGN KEY ("snapshotId") REFERENCES "ProfessionalApplicationSnapshot"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProfessionalApplicationReviewLog" ADD CONSTRAINT "ProfessionalApplicationReviewLog_actorUserId_fkey" FOREIGN KEY ("actorUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Review logs and snapshots are historical append-only records. PostgreSQL
-- RESTRICT does not prevent direct UPDATE/DELETE, so write permissions must be
-- granted only to the application role whose review service enforces append-only.

-- AddForeignKey
ALTER TABLE "ProfessionalRegulatoryIdentity" ADD CONSTRAINT "ProfessionalRegulatoryIdentity_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProfessionalRegulatoryIdentity" ADD CONSTRAINT "ProfessionalRegulatoryIdentity_applicationId_fkey" FOREIGN KEY ("applicationId") REFERENCES "ProfessionalApplication"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProfessionalRegulatoryIdentity" ADD CONSTRAINT "ProfessionalRegulatoryIdentity_verifiedByUserId_fkey" FOREIGN KEY ("verifiedByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- One non-terminal onboarding cycle per user. Terminal history is retained.
CREATE UNIQUE INDEX "ProfessionalApplication_one_active_per_user"
ON "ProfessionalApplication" ("userId")
WHERE "status" IN ('DRAFT', 'PENDING_REVIEW', 'NEEDS_CHANGES');

CREATE UNIQUE INDEX "ProfessionalApplicationSpecialty_one_primary"
ON "ProfessionalApplicationSpecialty" ("applicationId")
WHERE "isPrimary" = true;

CREATE UNIQUE INDEX "ProfessionalApplicationCredential_one_primary"
ON "ProfessionalApplicationCredential" ("applicationId")
WHERE "isPrimary" = true;

CREATE UNIQUE INDEX "ProfessionalApplicationAsset_one_active_avatar"
ON "ProfessionalApplicationAsset" ("applicationId")
WHERE "category" = 'AVATAR' AND "deletedAt" IS NULL;

CREATE UNIQUE INDEX "ProfessionalApplicationAsset_active_order_key"
ON "ProfessionalApplicationAsset" ("applicationId", "category", "sortOrder")
WHERE "deletedAt" IS NULL;

-- The fingerprint is a keyed application-level HMAC of the normalized private
-- document number. The recoverable value remains encrypted in ciphertext.
CREATE UNIQUE INDEX "ProfessionalRegulatoryIdentity_active_identity_key"
ON "ProfessionalRegulatoryIdentity" ("countryCode", "authorityNamespace", "documentType", "documentNumberFingerprint")
WHERE "deletedAt" IS NULL;

ALTER TABLE "ProfessionalApplication"
  ADD CONSTRAINT "ProfessionalApplication_cycle_positive" CHECK ("cycleNumber" > 0),
  ADD CONSTRAINT "ProfessionalApplication_revision_positive" CHECK ("currentRevision" > 0),
  ADD CONSTRAINT "ProfessionalApplication_step_positive" CHECK ("lastVisitedStep" > 0),
  ADD CONSTRAINT "ProfessionalApplication_country_code" CHECK ("practiceCountryCode" IS NULL OR "practiceCountryCode" ~ '^[A-Z]{2}$'),
  ADD CONSTRAINT "ProfessionalApplication_primary_phone_e164" CHECK ("primaryPhoneE164" IS NULL OR "primaryPhoneE164" ~ '^\+[1-9][0-9]{7,14}$'),
  ADD CONSTRAINT "ProfessionalApplication_alternate_phone_e164" CHECK ("alternatePhoneE164" IS NULL OR "alternatePhoneE164" ~ '^\+[1-9][0-9]{7,14}$'),
  ADD CONSTRAINT "ProfessionalApplication_status_timestamps" CHECK (
    ("status" = 'DRAFT' AND "submittedAt" IS NULL AND "decidedAt" IS NULL)
    OR ("status" IN ('PENDING_REVIEW', 'NEEDS_CHANGES') AND "submittedAt" IS NOT NULL AND "decidedAt" IS NULL)
    OR ("status" IN ('APPROVED', 'REJECTED') AND "submittedAt" IS NOT NULL AND "decidedAt" IS NOT NULL)
  ),
  ADD CONSTRAINT "ProfessionalApplication_decision_chronology" CHECK ("decidedAt" IS NULL OR "decidedAt" >= "submittedAt");

ALTER TABLE "ProfessionalCredential"
  ADD CONSTRAINT "ProfessionalCredential_country_code" CHECK ("countryCode" ~ '^[A-Z]{2}$'),
  ADD CONSTRAINT "ProfessionalCredential_registry_tuple" CHECK (
    num_nonnulls("registrationAuthorityId", "registrationNumberOriginal", "registrationNumberNormalized") IN (0, 3)
  ),
  ADD CONSTRAINT "ProfessionalCredential_dates" CHECK ("issuedAt" IS NULL OR "expiresAt" IS NULL OR "expiresAt" >= "issuedAt");

ALTER TABLE "ProfessionalApplicationCredential"
  ADD CONSTRAINT "ProfessionalApplicationCredential_sort_order" CHECK ("sortOrder" >= 0);

ALTER TABLE "CredentialDocument"
  ADD CONSTRAINT "CredentialDocument_size_positive" CHECK ("sizeBytes" > 0),
  ADD CONSTRAINT "CredentialDocument_page_count_positive" CHECK ("pageCount" IS NULL OR "pageCount" > 0),
  ADD CONSTRAINT "CredentialDocument_checksum_sha256" CHECK ("checksumSha256" ~ '^[0-9a-f]{64}$');

ALTER TABLE "ProfessionalApplicationLocation"
  ADD CONSTRAINT "ProfessionalApplicationLocation_country_code" CHECK ("countryCode" IS NULL OR "countryCode" ~ '^[A-Z]{2}$'),
  ADD CONSTRAINT "ProfessionalApplicationLocation_floor_nonnegative" CHECK ("floorNumber" IS NULL OR "floorNumber" >= 0),
  ADD CONSTRAINT "ProfessionalApplicationLocation_coordinate_pair" CHECK (("latitude" IS NULL) = ("longitude" IS NULL)),
  ADD CONSTRAINT "ProfessionalApplicationLocation_latitude_range" CHECK ("latitude" IS NULL OR "latitude" BETWEEN -90 AND 90),
  ADD CONSTRAINT "ProfessionalApplicationLocation_longitude_range" CHECK ("longitude" IS NULL OR "longitude" BETWEEN -180 AND 180),
  ADD CONSTRAINT "ProfessionalApplicationLocation_provider_pair" CHECK ("providerPlaceId" IS NULL OR "providerType" IS NOT NULL);

ALTER TABLE "ProfessionalApplicationAsset"
  ADD CONSTRAINT "ProfessionalApplicationAsset_size_positive" CHECK ("sizeBytes" > 0),
  ADD CONSTRAINT "ProfessionalApplicationAsset_dimensions_positive" CHECK ("width" > 0 AND "height" > 0),
  ADD CONSTRAINT "ProfessionalApplicationAsset_sort_order" CHECK ("sortOrder" >= 0),
  ADD CONSTRAINT "ProfessionalApplicationAsset_checksum_sha256" CHECK ("checksumSha256" ~ '^[0-9a-f]{64}$');

ALTER TABLE "ProfessionalApplicationSnapshot"
  ADD CONSTRAINT "ProfessionalApplicationSnapshot_revision_positive" CHECK ("revision" > 0),
  ADD CONSTRAINT "ProfessionalApplicationSnapshot_schema_positive" CHECK ("schemaVersion" > 0),
  ADD CONSTRAINT "ProfessionalApplicationSnapshot_payload_hash" CHECK ("payloadHash" ~ '^[0-9a-f]{64}$');

ALTER TABLE "ProfessionalRegulatoryIdentity"
  ADD CONSTRAINT "ProfessionalRegulatoryIdentity_country_code" CHECK ("countryCode" ~ '^[A-Z]{2}$'),
  ADD CONSTRAINT "ProfessionalRegulatoryIdentity_ciphertext_present" CHECK (length("documentNumberCiphertext") >= 16),
  ADD CONSTRAINT "ProfessionalRegulatoryIdentity_fingerprint" CHECK ("documentNumberFingerprint" ~ '^[0-9a-f]{64}$'),
  ADD CONSTRAINT "ProfessionalRegulatoryIdentity_key_version" CHECK ("encryptionKeyVersion" > 0),
  ADD CONSTRAINT "ProfessionalRegulatoryIdentity_normalization_version" CHECK ("normalizationVersion" > 0),
  ADD CONSTRAINT "ProfessionalRegulatoryIdentity_verification_timestamp" CHECK (
    "verificationStatus" <> 'VERIFIED' OR "verifiedAt" IS NOT NULL
  );
