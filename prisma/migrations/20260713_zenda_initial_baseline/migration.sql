-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "Role" AS ENUM ('SUPER_ADMIN', 'CLINIC_ADMIN', 'DOCTOR', 'ASSISTANT', 'PATIENT');

-- CreateEnum
CREATE TYPE "AppointmentStatus" AS ENUM ('PENDING', 'CONFIRMED', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED', 'MISSED');

-- CreateEnum
CREATE TYPE "PaymentStatus" AS ENUM ('PENDING_CASH', 'PENDING_TRANSFER', 'PAID', 'WAIVED', 'REFUNDED');

-- CreateEnum
CREATE TYPE "AppointmentType" AS ENUM ('IN_PERSON', 'TELEMEDICINE', 'HOME_VISIT');

-- CreateEnum
CREATE TYPE "SubscriptionStatus" AS ENUM ('ACTIVE', 'GRACE_PERIOD', 'INACTIVE');

-- CreateEnum
CREATE TYPE "PayerType" AS ENUM ('SELF', 'CLINIC');

-- CreateEnum
CREATE TYPE "VerificationStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED', 'SUSPENDED');

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "firstName" TEXT NOT NULL,
    "lastName" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "phone" TEXT,
    "role" "Role" NOT NULL DEFAULT 'PATIENT',
    "passwordHash" TEXT,
    "provider" TEXT,
    "googleId" TEXT,
    "fcmToken" TEXT,
    "resetPasswordToken" TEXT,
    "resetPasswordExpires" TIMESTAMP(3),
    "twoFactorCode" TEXT,
    "twoFactorExpires" TIMESTAMP(3),
    "is2FAEnabled" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SecurityLog" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "ipAddress" TEXT NOT NULL,
    "userAgent" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SecurityLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ClinicProfile" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "address" TEXT NOT NULL,
    "phone" TEXT,
    "logoUrl" TEXT,
    "latitude" DOUBLE PRECISION,
    "longitude" DOUBLE PRECISION,
    "color" VARCHAR(7),
    "kushkiCardToken" TEXT,
    "subscriptionStatus" "SubscriptionStatus" NOT NULL DEFAULT 'INACTIVE',
    "verificationStatus" "VerificationStatus" NOT NULL DEFAULT 'PENDING',
    "verifiedAt" TIMESTAMP(3),
    "verifiedByUserId" TEXT,
    "googleRefreshToken" TEXT,
    "googleAccessToken" TEXT,
    "googleTokenExpiry" TIMESTAMP(3),
    "outlookRefreshToken" TEXT,
    "outlookAccessToken" TEXT,
    "outlookTokenExpiry" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ClinicProfile_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DoctorProfile" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "licenseNumber" TEXT NOT NULL,
    "isVerified" BOOLEAN NOT NULL DEFAULT false,
    "verificationStatus" "VerificationStatus" NOT NULL DEFAULT 'PENDING',
    "verifiedAt" TIMESTAMP(3),
    "verifiedByUserId" TEXT,
    "isIndependent" BOOLEAN NOT NULL DEFAULT false,
    "bio" TEXT,
    "profileImageUrl" TEXT,
    "languages" TEXT[],
    "portfolioImages" TEXT[],
    "isAvailable" BOOLEAN NOT NULL DEFAULT true,
    "consultationPrice" DOUBLE PRECISION NOT NULL,
    "walletBalance" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "subscriptionStatus" "SubscriptionStatus" NOT NULL DEFAULT 'INACTIVE',
    "subscriptionValidUntil" TIMESTAMP(3),
    "paidBy" "PayerType" NOT NULL DEFAULT 'SELF',
    "googleRefreshToken" TEXT,
    "googleAccessToken" TEXT,
    "googleTokenExpiry" TIMESTAMP(3),
    "outlookRefreshToken" TEXT,
    "outlookAccessToken" TEXT,
    "outlookTokenExpiry" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DoctorProfile_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AssistantProfile" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "canViewFinances" BOOLEAN NOT NULL DEFAULT false,
    "doctorProfileId" TEXT,
    "clinicProfileId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AssistantProfile_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DoctorClinicWorkplace" (
    "id" TEXT NOT NULL,
    "doctorProfileId" TEXT NOT NULL,
    "clinicProfileId" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "joinedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "leftAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DoctorClinicWorkplace_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Specialty" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Specialty_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Insurance" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Insurance_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Appointment" (
    "id" TEXT NOT NULL,
    "patientId" TEXT NOT NULL,
    "doctorProfileId" TEXT NOT NULL,
    "clinicProfileId" TEXT NOT NULL,
    "serviceId" TEXT NOT NULL,
    "date" TIMESTAMP(3) NOT NULL,
    "startTime" TEXT NOT NULL,
    "endTime" TEXT NOT NULL,
    "startDatetime" TIMESTAMPTZ,
    "status" "AppointmentStatus" NOT NULL DEFAULT 'PENDING',
    "appointmentType" "AppointmentType" NOT NULL DEFAULT 'IN_PERSON',
    "notes" TEXT,
    "paymentMethod" TEXT NOT NULL DEFAULT 'NONE',
    "paymentStatus" "PaymentStatus" NOT NULL DEFAULT 'PENDING_CASH',
    "paymentId" TEXT,
    "verificationCode" TEXT,
    "commissionAmount" DOUBLE PRECISION,
    "cancellationReason" TEXT,
    "turnNumber" INTEGER,
    "isPatientConfirmed" BOOLEAN NOT NULL DEFAULT false,
    "reminder24hSent" BOOLEAN NOT NULL DEFAULT false,
    "reminder2hSent" BOOLEAN NOT NULL DEFAULT false,
    "reminder1hSent" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "googleEventId" TEXT,
    "outlookEventId" TEXT,

    CONSTRAINT "Appointment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Review" (
    "id" TEXT NOT NULL,
    "appointmentId" TEXT NOT NULL,
    "patientId" TEXT NOT NULL,
    "doctorProfileId" TEXT NOT NULL,
    "rating" INTEGER NOT NULL,
    "comment" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Review_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Service" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "price" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "duration" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "doctorProfileId" TEXT,
    "clinicProfileId" TEXT,

    CONSTRAINT "Service_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Certification" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "institution" TEXT NOT NULL,
    "year" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "doctorProfileId" TEXT NOT NULL,

    CONSTRAINT "Certification_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WorkSchedule" (
    "id" TEXT NOT NULL,
    "weekday" INTEGER NOT NULL,
    "timezone" TEXT,
    "startTime" TEXT NOT NULL,
    "endTime" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "workplaceId" TEXT NOT NULL,

    CONSTRAINT "WorkSchedule_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Invitation" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "role" "Role" NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "clinicProfileId" TEXT,
    "invitedByUserId" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "acceptedAt" TIMESTAMP(3),
    "revokedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Invitation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "_ClinicProfileToSpecialty" (
    "A" TEXT NOT NULL,
    "B" TEXT NOT NULL,

    CONSTRAINT "_ClinicProfileToSpecialty_AB_pkey" PRIMARY KEY ("A","B")
);

-- CreateTable
CREATE TABLE "_ClinicProfileToInsurance" (
    "A" TEXT NOT NULL,
    "B" TEXT NOT NULL,

    CONSTRAINT "_ClinicProfileToInsurance_AB_pkey" PRIMARY KEY ("A","B")
);

-- CreateTable
CREATE TABLE "_DoctorProfileToSpecialty" (
    "A" TEXT NOT NULL,
    "B" TEXT NOT NULL,

    CONSTRAINT "_DoctorProfileToSpecialty_AB_pkey" PRIMARY KEY ("A","B")
);

-- CreateTable
CREATE TABLE "_DoctorProfileToInsurance" (
    "A" TEXT NOT NULL,
    "B" TEXT NOT NULL,

    CONSTRAINT "_DoctorProfileToInsurance_AB_pkey" PRIMARY KEY ("A","B")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE UNIQUE INDEX "User_googleId_key" ON "User"("googleId");

-- CreateIndex
CREATE UNIQUE INDEX "User_resetPasswordToken_key" ON "User"("resetPasswordToken");

-- CreateIndex
CREATE INDEX "User_email_idx" ON "User"("email");

-- CreateIndex
CREATE INDEX "User_resetPasswordToken_idx" ON "User"("resetPasswordToken");

-- CreateIndex
CREATE INDEX "User_role_idx" ON "User"("role");

-- CreateIndex
CREATE INDEX "SecurityLog_userId_idx" ON "SecurityLog"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "ClinicProfile_userId_key" ON "ClinicProfile"("userId");

-- CreateIndex
CREATE INDEX "ClinicProfile_latitude_longitude_idx" ON "ClinicProfile"("latitude", "longitude");

-- CreateIndex
CREATE INDEX "ClinicProfile_subscriptionStatus_idx" ON "ClinicProfile"("subscriptionStatus");

-- CreateIndex
CREATE INDEX "ClinicProfile_verificationStatus_idx" ON "ClinicProfile"("verificationStatus");

-- CreateIndex
CREATE UNIQUE INDEX "DoctorProfile_userId_key" ON "DoctorProfile"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "DoctorProfile_licenseNumber_key" ON "DoctorProfile"("licenseNumber");

-- CreateIndex
CREATE INDEX "DoctorProfile_isVerified_idx" ON "DoctorProfile"("isVerified");

-- CreateIndex
CREATE INDEX "DoctorProfile_subscriptionStatus_idx" ON "DoctorProfile"("subscriptionStatus");

-- CreateIndex
CREATE INDEX "DoctorProfile_verificationStatus_idx" ON "DoctorProfile"("verificationStatus");

-- CreateIndex
CREATE UNIQUE INDEX "AssistantProfile_userId_key" ON "AssistantProfile"("userId");

-- CreateIndex
CREATE INDEX "AssistantProfile_doctorProfileId_idx" ON "AssistantProfile"("doctorProfileId");

-- CreateIndex
CREATE INDEX "AssistantProfile_clinicProfileId_idx" ON "AssistantProfile"("clinicProfileId");

-- CreateIndex
CREATE INDEX "DoctorClinicWorkplace_doctorProfileId_idx" ON "DoctorClinicWorkplace"("doctorProfileId");

-- CreateIndex
CREATE INDEX "DoctorClinicWorkplace_clinicProfileId_idx" ON "DoctorClinicWorkplace"("clinicProfileId");

-- CreateIndex
CREATE INDEX "DoctorClinicWorkplace_isActive_idx" ON "DoctorClinicWorkplace"("isActive");

-- CreateIndex
CREATE UNIQUE INDEX "DoctorClinicWorkplace_doctorProfileId_clinicProfileId_key" ON "DoctorClinicWorkplace"("doctorProfileId", "clinicProfileId");

-- CreateIndex
CREATE UNIQUE INDEX "Specialty_name_key" ON "Specialty"("name");

-- CreateIndex
CREATE INDEX "Specialty_name_idx" ON "Specialty"("name");

-- CreateIndex
CREATE UNIQUE INDEX "Insurance_name_key" ON "Insurance"("name");

-- CreateIndex
CREATE INDEX "Insurance_name_idx" ON "Insurance"("name");

-- CreateIndex
CREATE UNIQUE INDEX "Appointment_paymentId_key" ON "Appointment"("paymentId");

-- CreateIndex
CREATE UNIQUE INDEX "Appointment_verificationCode_key" ON "Appointment"("verificationCode");

-- CreateIndex
CREATE INDEX "Appointment_patientId_idx" ON "Appointment"("patientId");

-- CreateIndex
CREATE INDEX "Appointment_doctorProfileId_idx" ON "Appointment"("doctorProfileId");

-- CreateIndex
CREATE INDEX "Appointment_clinicProfileId_idx" ON "Appointment"("clinicProfileId");

-- CreateIndex
CREATE INDEX "Appointment_serviceId_idx" ON "Appointment"("serviceId");

-- CreateIndex
CREATE INDEX "Appointment_date_idx" ON "Appointment"("date");

-- CreateIndex
CREATE INDEX "Appointment_status_idx" ON "Appointment"("status");

-- CreateIndex
CREATE UNIQUE INDEX "Review_appointmentId_key" ON "Review"("appointmentId");

-- CreateIndex
CREATE INDEX "Review_doctorProfileId_idx" ON "Review"("doctorProfileId");

-- CreateIndex
CREATE INDEX "Review_patientId_idx" ON "Review"("patientId");

-- CreateIndex
CREATE INDEX "Service_doctorProfileId_idx" ON "Service"("doctorProfileId");

-- CreateIndex
CREATE INDEX "Service_clinicProfileId_idx" ON "Service"("clinicProfileId");

-- CreateIndex
CREATE INDEX "Certification_doctorProfileId_idx" ON "Certification"("doctorProfileId");

-- CreateIndex
CREATE INDEX "WorkSchedule_workplaceId_idx" ON "WorkSchedule"("workplaceId");

-- CreateIndex
CREATE UNIQUE INDEX "Invitation_tokenHash_key" ON "Invitation"("tokenHash");

-- CreateIndex
CREATE INDEX "Invitation_email_idx" ON "Invitation"("email");

-- CreateIndex
CREATE INDEX "Invitation_expiresAt_idx" ON "Invitation"("expiresAt");

-- CreateIndex
CREATE INDEX "Invitation_acceptedAt_idx" ON "Invitation"("acceptedAt");

-- CreateIndex
CREATE INDEX "Invitation_revokedAt_idx" ON "Invitation"("revokedAt");

-- CreateIndex
CREATE INDEX "Invitation_role_idx" ON "Invitation"("role");

-- CreateIndex
CREATE INDEX "Invitation_clinicProfileId_idx" ON "Invitation"("clinicProfileId");

-- CreateIndex
CREATE INDEX "_ClinicProfileToSpecialty_B_index" ON "_ClinicProfileToSpecialty"("B");

-- CreateIndex
CREATE INDEX "_ClinicProfileToInsurance_B_index" ON "_ClinicProfileToInsurance"("B");

-- CreateIndex
CREATE INDEX "_DoctorProfileToSpecialty_B_index" ON "_DoctorProfileToSpecialty"("B");

-- CreateIndex
CREATE INDEX "_DoctorProfileToInsurance_B_index" ON "_DoctorProfileToInsurance"("B");

-- AddForeignKey
ALTER TABLE "SecurityLog" ADD CONSTRAINT "SecurityLog_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClinicProfile" ADD CONSTRAINT "ClinicProfile_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DoctorProfile" ADD CONSTRAINT "DoctorProfile_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AssistantProfile" ADD CONSTRAINT "AssistantProfile_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AssistantProfile" ADD CONSTRAINT "AssistantProfile_doctorProfileId_fkey" FOREIGN KEY ("doctorProfileId") REFERENCES "DoctorProfile"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AssistantProfile" ADD CONSTRAINT "AssistantProfile_clinicProfileId_fkey" FOREIGN KEY ("clinicProfileId") REFERENCES "ClinicProfile"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DoctorClinicWorkplace" ADD CONSTRAINT "DoctorClinicWorkplace_doctorProfileId_fkey" FOREIGN KEY ("doctorProfileId") REFERENCES "DoctorProfile"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DoctorClinicWorkplace" ADD CONSTRAINT "DoctorClinicWorkplace_clinicProfileId_fkey" FOREIGN KEY ("clinicProfileId") REFERENCES "ClinicProfile"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Appointment" ADD CONSTRAINT "Appointment_patientId_fkey" FOREIGN KEY ("patientId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Appointment" ADD CONSTRAINT "Appointment_doctorProfileId_fkey" FOREIGN KEY ("doctorProfileId") REFERENCES "DoctorProfile"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Appointment" ADD CONSTRAINT "Appointment_clinicProfileId_fkey" FOREIGN KEY ("clinicProfileId") REFERENCES "ClinicProfile"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Appointment" ADD CONSTRAINT "Appointment_serviceId_fkey" FOREIGN KEY ("serviceId") REFERENCES "Service"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Review" ADD CONSTRAINT "Review_appointmentId_fkey" FOREIGN KEY ("appointmentId") REFERENCES "Appointment"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Review" ADD CONSTRAINT "Review_patientId_fkey" FOREIGN KEY ("patientId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Review" ADD CONSTRAINT "Review_doctorProfileId_fkey" FOREIGN KEY ("doctorProfileId") REFERENCES "DoctorProfile"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Service" ADD CONSTRAINT "Service_doctorProfileId_fkey" FOREIGN KEY ("doctorProfileId") REFERENCES "DoctorProfile"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Service" ADD CONSTRAINT "Service_clinicProfileId_fkey" FOREIGN KEY ("clinicProfileId") REFERENCES "ClinicProfile"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Certification" ADD CONSTRAINT "Certification_doctorProfileId_fkey" FOREIGN KEY ("doctorProfileId") REFERENCES "DoctorProfile"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkSchedule" ADD CONSTRAINT "WorkSchedule_workplaceId_fkey" FOREIGN KEY ("workplaceId") REFERENCES "DoctorClinicWorkplace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Invitation" ADD CONSTRAINT "Invitation_clinicProfileId_fkey" FOREIGN KEY ("clinicProfileId") REFERENCES "ClinicProfile"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Invitation" ADD CONSTRAINT "Invitation_invitedByUserId_fkey" FOREIGN KEY ("invitedByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "_ClinicProfileToSpecialty" ADD CONSTRAINT "_ClinicProfileToSpecialty_A_fkey" FOREIGN KEY ("A") REFERENCES "ClinicProfile"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "_ClinicProfileToSpecialty" ADD CONSTRAINT "_ClinicProfileToSpecialty_B_fkey" FOREIGN KEY ("B") REFERENCES "Specialty"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "_ClinicProfileToInsurance" ADD CONSTRAINT "_ClinicProfileToInsurance_A_fkey" FOREIGN KEY ("A") REFERENCES "ClinicProfile"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "_ClinicProfileToInsurance" ADD CONSTRAINT "_ClinicProfileToInsurance_B_fkey" FOREIGN KEY ("B") REFERENCES "Insurance"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "_DoctorProfileToSpecialty" ADD CONSTRAINT "_DoctorProfileToSpecialty_A_fkey" FOREIGN KEY ("A") REFERENCES "DoctorProfile"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "_DoctorProfileToSpecialty" ADD CONSTRAINT "_DoctorProfileToSpecialty_B_fkey" FOREIGN KEY ("B") REFERENCES "Specialty"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "_DoctorProfileToInsurance" ADD CONSTRAINT "_DoctorProfileToInsurance_A_fkey" FOREIGN KEY ("A") REFERENCES "DoctorProfile"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "_DoctorProfileToInsurance" ADD CONSTRAINT "_DoctorProfileToInsurance_B_fkey" FOREIGN KEY ("B") REFERENCES "Insurance"("id") ON DELETE CASCADE ON UPDATE CASCADE;
