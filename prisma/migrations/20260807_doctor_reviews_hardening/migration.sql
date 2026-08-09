ALTER TABLE "Review"
ADD CONSTRAINT "Review_rating_range_check" CHECK ("rating" BETWEEN 1 AND 5);

CREATE INDEX "Review_doctorProfileId_createdAt_idx"
ON "Review"("doctorProfileId", "createdAt" DESC);
