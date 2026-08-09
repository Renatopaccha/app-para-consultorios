-- Refuse to alter the protection if inconsistent active data already exists.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM "ScheduleBlock" a
    JOIN "ScheduleBlock" b
      ON a.id < b.id
     AND a."doctorProfileId" = b."doctorProfileId"
     AND a."deletedAt" IS NULL
     AND b."deletedAt" IS NULL
     AND tstzrange(a."startsAt", a."endsAt", '[)')
         && tstzrange(b."startsAt", b."endsAt", '[)')
  ) THEN
    RAISE EXCEPTION 'Cannot create active-only ScheduleBlock exclusion: overlapping active blocks exist';
  END IF;
END $$;

ALTER TABLE "ScheduleBlock"
  DROP CONSTRAINT "ScheduleBlock_no_doctor_overlap";

ALTER TABLE "ScheduleBlock"
  ADD CONSTRAINT "ScheduleBlock_no_doctor_overlap"
  EXCLUDE USING gist (
    "doctorProfileId" WITH =,
    tstzrange("startsAt", "endsAt", '[)') WITH &&
  ) WHERE ("deletedAt" IS NULL);
