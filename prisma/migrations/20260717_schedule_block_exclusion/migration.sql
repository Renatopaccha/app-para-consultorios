ALTER TABLE "ScheduleBlock" ADD CONSTRAINT "ScheduleBlock_no_doctor_overlap"
  EXCLUDE USING gist (
    "doctorProfileId" WITH =,
    tstzrange("startsAt", "endsAt", '[)') WITH &&
  );
