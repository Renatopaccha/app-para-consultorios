CREATE TYPE "ScheduleBlockType" AS ENUM ('BLOCK', 'PERSONAL');

ALTER TABLE "ScheduleBlock"
  ADD COLUMN "type" "ScheduleBlockType" NOT NULL DEFAULT 'BLOCK';
