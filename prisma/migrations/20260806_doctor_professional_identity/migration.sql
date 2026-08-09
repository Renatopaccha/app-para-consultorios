CREATE TYPE "ProfessionCode" AS ENUM ('MEDICINE', 'DENTISTRY', 'PSYCHOLOGY', 'NURSING', 'OTHER');
CREATE TYPE "ProfessionalTitle" AS ENUM ('DR', 'DRA', 'DENTIST_MALE', 'DENTIST_FEMALE', 'PSYCHOLOGIST_MALE', 'PSYCHOLOGIST_FEMALE', 'LICENSED_MALE', 'LICENSED_FEMALE', 'OTHER');

ALTER TABLE "DoctorProfile"
ADD COLUMN "professionCode" "ProfessionCode",
ADD COLUMN "displayTitle" "ProfessionalTitle",
ADD COLUMN "customDisplayTitle" VARCHAR(40);

-- Existing doctors remain intentionally untitled. No title or gender is
-- inferred from names, photographs, specialties or legacy data.
