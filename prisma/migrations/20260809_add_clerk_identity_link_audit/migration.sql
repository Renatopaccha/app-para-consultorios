-- Additive Clerk identity mapping. Zenda's existing User UUID remains canonical.
ALTER TABLE "User" ADD COLUMN "clerkUserId" TEXT;

CREATE TYPE "AuthIdentityLinkEvent" AS ENUM ('LINKED', 'LINK_REJECTED', 'COLLISION', 'UNLINKED', 'SUSPENDED');

CREATE TABLE "AuthIdentityLinkAudit" (
    "id" TEXT NOT NULL,
    "userId" TEXT,
    "clerkUserId" TEXT NOT NULL,
    "event" "AuthIdentityLinkEvent" NOT NULL,
    "actorUserId" TEXT,
    "reasonCode" TEXT,
    "requestId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuthIdentityLinkAudit_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "User_clerkUserId_key" ON "User"("clerkUserId");
CREATE INDEX "AuthIdentityLinkAudit_userId_createdAt_idx" ON "AuthIdentityLinkAudit"("userId", "createdAt");
CREATE INDEX "AuthIdentityLinkAudit_clerkUserId_createdAt_idx" ON "AuthIdentityLinkAudit"("clerkUserId", "createdAt");
CREATE INDEX "AuthIdentityLinkAudit_event_createdAt_idx" ON "AuthIdentityLinkAudit"("event", "createdAt");

ALTER TABLE "AuthIdentityLinkAudit"
  ADD CONSTRAINT "AuthIdentityLinkAudit_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "AuthIdentityLinkAudit"
  ADD CONSTRAINT "AuthIdentityLinkAudit_actorUserId_fkey"
  FOREIGN KEY ("actorUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
