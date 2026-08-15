import prisma from '../../prisma';
import { assertTestExecutionEnvironment, getTestDatabaseUrl } from '../../config/testDatabase';

/** Fails fast before any test can reach a database. */
export function assertIntegrationDatabase(): string {
  assertTestExecutionEnvironment();
  return getTestDatabaseUrl();
}

/**
 * Deletes test fixtures only. It never creates, drops or resets a database.
 * The migration lifecycle is owned by db:test:migrate.
 */
export async function clearIntegrationDatabase(): Promise<void> {
  assertIntegrationDatabase();
  await prisma.$transaction([
    prisma.professionalAccessAuditLog.deleteMany(),
    prisma.professionalAccess.deleteMany(),
    prisma.userRoleAssignment.deleteMany(),
    prisma.professionalApplicationReviewLog.deleteMany(),
    prisma.professionalApplicationSnapshot.deleteMany(),
    prisma.professionalRegulatoryIdentity.deleteMany(),
    prisma.professionalApplicationAsset.deleteMany(),
    prisma.professionalApplicationLanguage.deleteMany(),
    prisma.professionalApplicationLocation.deleteMany(),
    prisma.professionalApplicationCredential.deleteMany(),
    prisma.professionalApplicationSpecialty.deleteMany(),
    prisma.credentialDocument.deleteMany(),
    prisma.professionalCredential.deleteMany(),
    prisma.professionalApplication.deleteMany(),
    prisma.authIdentityLinkAudit.deleteMany(),
    prisma.notificationDelivery.deleteMany(),
    prisma.userNotification.deleteMany(),
    prisma.notificationOutbox.deleteMany(),
    prisma.invitation.deleteMany(),
    prisma.review.deleteMany(),
    prisma.paymentVerificationAttempt.deleteMany(),
    prisma.paymentIdempotencyKey.deleteMany(),
    prisma.paymentEvent.deleteMany(),
    prisma.payment.deleteMany(),
    prisma.appointmentTurn.deleteMany(),
    prisma.appointmentChangeLog.deleteMany(),
    prisma.appointment.deleteMany(),
    prisma.patientInvitation.deleteMany(),
    prisma.workSchedule.deleteMany(),
    prisma.doctorClinicWorkplace.deleteMany(),
    prisma.certificationAuditLog.deleteMany(),
    prisma.certification.deleteMany(),
    prisma.service.deleteMany(),
    prisma.assistantProfile.deleteMany(),
    prisma.doctorProfile.deleteMany(),
    prisma.clinicProfile.deleteMany(),
    prisma.securityLog.deleteMany(),
    prisma.user.deleteMany(),
    prisma.insurance.deleteMany(),
    prisma.specialty.deleteMany(),
    prisma.registrationAuthority.deleteMany(),
    prisma.institution.deleteMany(),
    prisma.language.deleteMany(),
    prisma.healthProfession.deleteMany(),
  ]);
}
