DROP INDEX IF EXISTS "UserNotification_outboxId_key";
CREATE UNIQUE INDEX "UserNotification_userId_outboxId_key" ON "UserNotification"("userId", "outboxId");
