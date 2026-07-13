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
    prisma.invitation.deleteMany(),
    prisma.review.deleteMany(),
    prisma.paymentVerificationAttempt.deleteMany(),
    prisma.paymentIdempotencyKey.deleteMany(),
    prisma.paymentEvent.deleteMany(),
    prisma.payment.deleteMany(),
    prisma.appointmentTurn.deleteMany(),
    prisma.appointmentChangeLog.deleteMany(),
    prisma.appointment.deleteMany(),
    prisma.workSchedule.deleteMany(),
    prisma.doctorClinicWorkplace.deleteMany(),
    prisma.certification.deleteMany(),
    prisma.service.deleteMany(),
    prisma.assistantProfile.deleteMany(),
    prisma.doctorProfile.deleteMany(),
    prisma.clinicProfile.deleteMany(),
    prisma.securityLog.deleteMany(),
    prisma.user.deleteMany(),
    prisma.insurance.deleteMany(),
    prisma.specialty.deleteMany(),
  ]);
}
