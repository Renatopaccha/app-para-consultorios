import type { PrismaClient } from '../../generated/prisma';
import { isValidEmail, normalizeEmail } from './emailIdentity.service';

const CURRENT_DEVELOPMENT_DOCTOR_EMAIL = 'doctor@zenda.test';

type RelationCounts = {
  appointments: number;
  payments: number;
  services: number;
  certifications: number;
  reviews: number;
  workplaces: number;
  scheduleBlocks: number;
  patientInvitations: number;
};

export type DevelopmentDoctorEmailUpdateResult = {
  userId: string;
  doctorProfileId: string;
  previousEmail: string;
  newEmail: string;
  relationCounts: RelationCounts;
};

export class DevelopmentDoctorEmailError extends Error {}

/**
 * Moves only the email identity of the known development doctor. The caller is
 * responsible for limiting invocation to the local development script; this is
 * deliberately not an HTTP operation and never contacts Clerk.
 */
export async function updateExistingDevelopmentDoctorEmail(
  prisma: PrismaClient,
  requestedEmail: string | undefined,
): Promise<DevelopmentDoctorEmailUpdateResult> {
  const newEmail = normalizeEmail(requestedEmail ?? '');
  const currentEmail = normalizeEmail(CURRENT_DEVELOPMENT_DOCTOR_EMAIL);

  if (!newEmail) throw new DevelopmentDoctorEmailError('DEV_DOCTOR_EMAIL es obligatoria.');
  if (!isValidEmail(newEmail)) throw new DevelopmentDoctorEmailError('DEV_DOCTOR_EMAIL debe ser un correo válido.');
  if (newEmail === currentEmail) throw new DevelopmentDoctorEmailError('DEV_DOCTOR_EMAIL debe ser diferente al correo temporal actual.');

  return prisma.$transaction(async (tx) => {
    const doctorUser = await tx.user.findUnique({
      where: { emailNormalized: currentEmail },
      select: {
        id: true,
        email: true,
        emailNormalized: true,
        role: true,
        passwordHash: true,
        clerkUserId: true,
        doctorProfile: { select: { id: true } },
      },
    });
    if (!doctorUser) throw new DevelopmentDoctorEmailError('No se encontró el doctor de desarrollo esperado.');
    if (doctorUser.role !== 'DOCTOR' || !doctorUser.doctorProfile) {
      throw new DevelopmentDoctorEmailError('El usuario temporal encontrado no es un DOCTOR con DoctorProfile.');
    }

    const collision = await tx.user.findUnique({ where: { emailNormalized: newEmail }, select: { id: true } });
    if (collision && collision.id !== doctorUser.id) {
      throw new DevelopmentDoctorEmailError('DEV_DOCTOR_EMAIL ya pertenece a otro usuario.');
    }

    const profileId = doctorUser.doctorProfile.id;
    const beforeCounts: RelationCounts = {
      appointments: await tx.appointment.count({ where: { doctorProfileId: profileId } }),
      payments: await tx.payment.count({ where: { appointment: { doctorProfileId: profileId } } }),
      services: await tx.service.count({ where: { doctorProfileId: profileId } }),
      certifications: await tx.certification.count({ where: { doctorProfileId: profileId } }),
      reviews: await tx.review.count({ where: { doctorProfileId: profileId } }),
      workplaces: await tx.doctorClinicWorkplace.count({ where: { doctorProfileId: profileId } }),
      scheduleBlocks: await tx.scheduleBlock.count({ where: { doctorProfileId: profileId } }),
      patientInvitations: await tx.patientInvitation.count({ where: { doctorProfileId: profileId } }),
    };

    await tx.user.update({
      where: { id: doctorUser.id },
      data: { email: newEmail, emailNormalized: newEmail },
    });

    const updated = await tx.user.findUniqueOrThrow({
      where: { id: doctorUser.id },
      select: {
        id: true,
        email: true,
        emailNormalized: true,
        role: true,
        passwordHash: true,
        clerkUserId: true,
        doctorProfile: { select: { id: true } },
      },
    });
    const afterCounts: RelationCounts = {
      appointments: await tx.appointment.count({ where: { doctorProfileId: profileId } }),
      payments: await tx.payment.count({ where: { appointment: { doctorProfileId: profileId } } }),
      services: await tx.service.count({ where: { doctorProfileId: profileId } }),
      certifications: await tx.certification.count({ where: { doctorProfileId: profileId } }),
      reviews: await tx.review.count({ where: { doctorProfileId: profileId } }),
      workplaces: await tx.doctorClinicWorkplace.count({ where: { doctorProfileId: profileId } }),
      scheduleBlocks: await tx.scheduleBlock.count({ where: { doctorProfileId: profileId } }),
      patientInvitations: await tx.patientInvitation.count({ where: { doctorProfileId: profileId } }),
    };

    const preserved = updated.id === doctorUser.id
      && updated.doctorProfile?.id === profileId
      && updated.role === 'DOCTOR'
      && updated.passwordHash === doctorUser.passwordHash
      && updated.clerkUserId === doctorUser.clerkUserId
      && updated.email === newEmail
      && updated.emailNormalized === newEmail
      && JSON.stringify(beforeCounts) === JSON.stringify(afterCounts);
    if (!preserved) throw new DevelopmentDoctorEmailError('La verificación posterior falló; no se aplicó ningún cambio.');

    return { userId: updated.id, doctorProfileId: profileId, previousEmail: doctorUser.email, newEmail, relationCounts: afterCounts };
  });
}

/** The CLI rejects any non-local or non-development configuration before writes. */
export function assertLocalDevelopmentExecution(environment: NodeJS.ProcessEnv): void {
  if (environment.NODE_ENV !== 'development') {
    throw new DevelopmentDoctorEmailError('Este script solo puede ejecutarse con NODE_ENV=development.');
  }
  const databaseUrl = environment.DATABASE_URL;
  if (!databaseUrl) throw new DevelopmentDoctorEmailError('DATABASE_URL es obligatoria para este script de desarrollo.');

  let parsed: URL;
  try {
    parsed = new URL(databaseUrl);
  } catch {
    throw new DevelopmentDoctorEmailError('DATABASE_URL no es una URL PostgreSQL válida.');
  }
  if (!['postgres:', 'postgresql:'].includes(parsed.protocol) || !['localhost', '127.0.0.1', '::1'].includes(parsed.hostname)) {
    throw new DevelopmentDoctorEmailError('El script solo permite una base PostgreSQL local de desarrollo.');
  }
  if (/(^|[_-])(prod|production)([_-]|$)/i.test(parsed.pathname)) {
    throw new DevelopmentDoctorEmailError('El script rechazó una base identificada como producción.');
  }
}
