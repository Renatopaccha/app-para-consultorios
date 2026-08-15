/*
  Warnings:

  - A unique constraint covering the columns `[healthProfessionId,code]` on the table `Specialty` will be added. If there are existing duplicate values, this will fail.
  - A unique constraint covering the columns `[healthProfessionId,nameNormalized]` on the table `Specialty` will be added. If there are existing duplicate values, this will fail.
  - Made the column `code` on table `Specialty` required. This step will fail if there are existing NULL values in that column.
  - Made the column `healthProfessionId` on table `Specialty` required. This step will fail if there are existing NULL values in that column.
  - Made the column `nameNormalized` on table `Specialty` required. This step will fail if there are existing NULL values in that column.

*/
-- DropIndex
DROP INDEX "Specialty_name_key";

-- AlterTable
ALTER TABLE "Specialty" ALTER COLUMN "code" SET NOT NULL,
ALTER COLUMN "healthProfessionId" SET NOT NULL,
ALTER COLUMN "nameNormalized" SET NOT NULL;

-- CreateIndex
CREATE UNIQUE INDEX "Specialty_healthProfessionId_code_key" ON "Specialty"("healthProfessionId", "code");

-- CreateIndex
CREATE UNIQUE INDEX "Specialty_healthProfessionId_nameNormalized_key" ON "Specialty"("healthProfessionId", "nameNormalized");
