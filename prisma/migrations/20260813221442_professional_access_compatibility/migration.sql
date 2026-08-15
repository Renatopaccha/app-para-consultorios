-- CreateEnum
CREATE TYPE "ProfessionalAccessStatus" AS ENUM ('ACTIVE', 'SUSPENDED', 'REVOKED');

-- CreateEnum
CREATE TYPE "ProfessionalAccessSource" AS ENUM ('APPLICATION_APPROVAL', 'LEGACY_BACKFILL', 'ADMINISTRATIVE_REPAIR');

-- CreateEnum
CREATE TYPE "ProfessionalAccessAuditAction" AS ENUM ('ACTIVATED', 'SUSPENDED', 'REACTIVATED', 'REVOKED', 'REPAIRED');

-- CreateEnum
CREATE TYPE "UserRoleAssignmentSource" AS ENUM ('PROFESSIONAL_APPROVAL', 'LEGACY_BACKFILL', 'ADMINISTRATIVE', 'INVITATION');

-- CreateTable
CREATE TABLE "ProfessionalAccess" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "doctorProfileId" TEXT NOT NULL,
    "approvedSnapshotId" TEXT,
    "status" "ProfessionalAccessStatus" NOT NULL,
    "source" "ProfessionalAccessSource" NOT NULL,
    "activatedAt" TIMESTAMPTZ(3) NOT NULL,
    "suspendedAt" TIMESTAMPTZ(3),
    "revokedAt" TIMESTAMPTZ(3),
    "reasonCode" VARCHAR(80),
    "updatedByUserId" TEXT,
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "ProfessionalAccess_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProfessionalAccessAuditLog" (
    "id" TEXT NOT NULL,
    "accessId" TEXT NOT NULL,
    "actorUserId" TEXT,
    "action" "ProfessionalAccessAuditAction" NOT NULL,
    "previousStatus" "ProfessionalAccessStatus",
    "newStatus" "ProfessionalAccessStatus" NOT NULL,
    "reasonCode" VARCHAR(80),
    "internalNote" VARCHAR(2000),
    "requestId" VARCHAR(120),
    "idempotencyKey" VARCHAR(120),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ProfessionalAccessAuditLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UserRoleAssignment" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "role" "Role" NOT NULL,
    "scopeKey" VARCHAR(80) NOT NULL,
    "source" "UserRoleAssignmentSource" NOT NULL,
    "sourceId" VARCHAR(120),
    "assignedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "revokedAt" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "UserRoleAssignment_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ProfessionalAccess_userId_key" ON "ProfessionalAccess"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "ProfessionalAccess_doctorProfileId_key" ON "ProfessionalAccess"("doctorProfileId");

-- CreateIndex
CREATE UNIQUE INDEX "ProfessionalAccess_approvedSnapshotId_key" ON "ProfessionalAccess"("approvedSnapshotId");

-- CreateIndex
CREATE INDEX "ProfessionalAccess_status_createdAt_idx" ON "ProfessionalAccess"("status", "createdAt");

-- CreateIndex
CREATE INDEX "ProfessionalAccess_updatedByUserId_updatedAt_idx" ON "ProfessionalAccess"("updatedByUserId", "updatedAt");

-- CreateIndex
CREATE UNIQUE INDEX "ProfessionalAccessAuditLog_idempotencyKey_key" ON "ProfessionalAccessAuditLog"("idempotencyKey");

-- CreateIndex
CREATE INDEX "ProfessionalAccessAuditLog_accessId_createdAt_idx" ON "ProfessionalAccessAuditLog"("accessId", "createdAt");

-- CreateIndex
CREATE INDEX "ProfessionalAccessAuditLog_actorUserId_createdAt_idx" ON "ProfessionalAccessAuditLog"("actorUserId", "createdAt");

-- CreateIndex
CREATE INDEX "ProfessionalAccessAuditLog_newStatus_createdAt_idx" ON "ProfessionalAccessAuditLog"("newStatus", "createdAt");

-- CreateIndex
CREATE INDEX "UserRoleAssignment_role_scopeKey_revokedAt_idx" ON "UserRoleAssignment"("role", "scopeKey", "revokedAt");

-- CreateIndex
CREATE INDEX "UserRoleAssignment_source_sourceId_idx" ON "UserRoleAssignment"("source", "sourceId");

-- CreateIndex
CREATE UNIQUE INDEX "UserRoleAssignment_userId_role_scopeKey_key" ON "UserRoleAssignment"("userId", "role", "scopeKey");

-- AddForeignKey
ALTER TABLE "ProfessionalAccess" ADD CONSTRAINT "ProfessionalAccess_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProfessionalAccess" ADD CONSTRAINT "ProfessionalAccess_doctorProfileId_fkey" FOREIGN KEY ("doctorProfileId") REFERENCES "DoctorProfile"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProfessionalAccess" ADD CONSTRAINT "ProfessionalAccess_approvedSnapshotId_fkey" FOREIGN KEY ("approvedSnapshotId") REFERENCES "ProfessionalApplicationSnapshot"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProfessionalAccess" ADD CONSTRAINT "ProfessionalAccess_updatedByUserId_fkey" FOREIGN KEY ("updatedByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProfessionalAccessAuditLog" ADD CONSTRAINT "ProfessionalAccessAuditLog_accessId_fkey" FOREIGN KEY ("accessId") REFERENCES "ProfessionalAccess"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProfessionalAccessAuditLog" ADD CONSTRAINT "ProfessionalAccessAuditLog_actorUserId_fkey" FOREIGN KEY ("actorUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserRoleAssignment" ADD CONSTRAINT "UserRoleAssignment_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Domain invariants not representable in Prisma's schema language.
ALTER TABLE "ProfessionalAccess"
  ADD CONSTRAINT "ProfessionalAccess_version_positive" CHECK ("version" > 0),
  ADD CONSTRAINT "ProfessionalAccess_status_timestamps" CHECK (
    ("status" = 'ACTIVE' AND "suspendedAt" IS NULL AND "revokedAt" IS NULL)
    OR ("status" = 'SUSPENDED' AND "suspendedAt" IS NOT NULL AND "revokedAt" IS NULL)
    OR ("status" = 'REVOKED' AND "revokedAt" IS NOT NULL)
  );

ALTER TABLE "ProfessionalAccessAuditLog"
  ADD CONSTRAINT "ProfessionalAccessAuditLog_action_status" CHECK (
    ("action" IN ('ACTIVATED', 'REACTIVATED') AND "newStatus" = 'ACTIVE')
    OR ("action" = 'SUSPENDED' AND "newStatus" = 'SUSPENDED')
    OR ("action" = 'REVOKED' AND "newStatus" = 'REVOKED')
    OR "action" = 'REPAIRED'
  );

ALTER TABLE "UserRoleAssignment"
  ADD CONSTRAINT "UserRoleAssignment_scope_global" CHECK ("scopeKey" = 'GLOBAL'),
  ADD CONSTRAINT "UserRoleAssignment_revocation_timeline" CHECK ("revokedAt" IS NULL OR "revokedAt" >= "assignedAt");
