-- AlterTable
ALTER TABLE "Specialty" ADD COLUMN     "code" VARCHAR(80),
ADD COLUMN     "healthProfessionId" TEXT,
ADD COLUMN     "isActive" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "nameNormalized" VARCHAR(160);

-- CreateTable
CREATE TABLE "HealthProfession" (
    "id" TEXT NOT NULL,
    "code" VARCHAR(40) NOT NULL,
    "name" VARCHAR(120) NOT NULL,
    "nameNormalized" VARCHAR(120) NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "requiresSpecialty" BOOLEAN NOT NULL DEFAULT false,
    "credentialPolicyVersion" INTEGER NOT NULL DEFAULT 1,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "HealthProfession_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RegistrationAuthority" (
    "id" TEXT NOT NULL,
    "countryCode" CHAR(2) NOT NULL,
    "registryNamespace" VARCHAR(100) NOT NULL,
    "name" VARCHAR(180) NOT NULL,
    "nameNormalized" VARCHAR(180) NOT NULL,
    "healthProfessionId" TEXT,
    "isVerified" BOOLEAN NOT NULL DEFAULT false,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "sourceReference" VARCHAR(500),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "RegistrationAuthority_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Institution" (
    "id" TEXT NOT NULL,
    "countryCode" CHAR(2) NOT NULL,
    "name" VARCHAR(180) NOT NULL,
    "nameNormalized" VARCHAR(180) NOT NULL,
    "isVerified" BOOLEAN NOT NULL DEFAULT false,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "sourceReference" VARCHAR(500),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "Institution_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Language" (
    "id" TEXT NOT NULL,
    "code" VARCHAR(16) NOT NULL,
    "name" VARCHAR(80) NOT NULL,
    "nameNormalized" VARCHAR(80) NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "Language_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "HealthProfession_code_key" ON "HealthProfession"("code");

-- CreateIndex
CREATE UNIQUE INDEX "HealthProfession_nameNormalized_key" ON "HealthProfession"("nameNormalized");

-- CreateIndex
CREATE INDEX "HealthProfession_isActive_sortOrder_idx" ON "HealthProfession"("isActive", "sortOrder");

-- CreateIndex
CREATE INDEX "RegistrationAuthority_countryCode_isActive_nameNormalized_idx" ON "RegistrationAuthority"("countryCode", "isActive", "nameNormalized");

-- CreateIndex
CREATE INDEX "RegistrationAuthority_healthProfessionId_idx" ON "RegistrationAuthority"("healthProfessionId");

-- CreateIndex
CREATE UNIQUE INDEX "RegistrationAuthority_countryCode_registryNamespace_key" ON "RegistrationAuthority"("countryCode", "registryNamespace");

-- CreateIndex
CREATE INDEX "Institution_countryCode_isActive_nameNormalized_idx" ON "Institution"("countryCode", "isActive", "nameNormalized");

-- CreateIndex
CREATE UNIQUE INDEX "Institution_countryCode_nameNormalized_key" ON "Institution"("countryCode", "nameNormalized");

-- CreateIndex
CREATE UNIQUE INDEX "Language_code_key" ON "Language"("code");

-- CreateIndex
CREATE UNIQUE INDEX "Language_nameNormalized_key" ON "Language"("nameNormalized");

-- CreateIndex
CREATE INDEX "Language_isActive_nameNormalized_idx" ON "Language"("isActive", "nameNormalized");

-- CreateIndex
CREATE INDEX "Specialty_healthProfessionId_code_idx" ON "Specialty"("healthProfessionId", "code");

-- CreateIndex
CREATE INDEX "Specialty_healthProfessionId_isActive_nameNormalized_idx" ON "Specialty"("healthProfessionId", "isActive", "nameNormalized");

-- AddForeignKey
ALTER TABLE "RegistrationAuthority" ADD CONSTRAINT "RegistrationAuthority_healthProfessionId_fkey" FOREIGN KEY ("healthProfessionId") REFERENCES "HealthProfession"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Specialty" ADD CONSTRAINT "Specialty_healthProfessionId_fkey" FOREIGN KEY ("healthProfessionId") REFERENCES "HealthProfession"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
