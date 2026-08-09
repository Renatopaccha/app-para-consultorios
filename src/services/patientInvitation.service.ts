import { Prisma, PatientInvitationStatus } from '../../generated/prisma';
import { BookingError } from './appointmentBooking.service';
import { createOpaqueToken, hashOpaqueToken, isValidEmail, normalizeEmail } from './emailIdentity.service';

const PATIENT_INVITATION_TTL_MS = 7 * 24 * 60 * 60 * 1000;

export type InvitedPatientInput = { email: string; firstName: string; lastName: string; phone?: string | null; invitedByUserId: string; doctorProfileId: string; clinicProfileId: string };

export async function resolvePatientInvitation(tx: Prisma.TransactionClient, input: InvitedPatientInput) {
  const emailNormalized = normalizeEmail(input.email);
  if (!isValidEmail(emailNormalized)) throw new BookingError('INVALID_PATIENT_EMAIL', 400, 'El correo del paciente no es válido.');
  const firstName = input.firstName.trim();
  const lastName = input.lastName.trim();
  if (!firstName || !lastName) throw new BookingError('INVALID_PATIENT', 400, 'Nombre y apellido del paciente son obligatorios.');
  const phone = input.phone?.trim() || null;
  if (phone && (phone.length < 5 || phone.length > 30)) throw new BookingError('INVALID_PATIENT_PHONE', 400, 'El teléfono del paciente no es válido.');

  const existingUser = await tx.user.findUnique({
    where: { emailNormalized },
    select: { id: true, email: true, firstName: true, lastName: true, phone: true, role: true },
  });
  if (existingUser) {
    if (existingUser.role !== 'PATIENT') throw new BookingError('PATIENT_EMAIL_ROLE_CONFLICT', 409, 'El correo pertenece a una cuenta que no es de paciente.');
    return { patient: existingUser, invitation: null, invitationToken: null, isNewInvitation: false };
  }

  const now = new Date();
  await tx.patientInvitation.updateMany({
    where: { emailNormalized, status: 'PENDING', expiresAt: { lte: now } },
    data: { status: 'EXPIRED' },
  });
  const active = await tx.patientInvitation.findFirst({
    where: { emailNormalized, status: 'PENDING', expiresAt: { gt: now } },
    orderBy: { createdAt: 'desc' },
  });
  if (active) return { patient: null, invitation: active, invitationToken: null, isNewInvitation: false };

  const token = createOpaqueToken();
  try {
    const invitation = await tx.patientInvitation.create({
      data: {
        email: emailNormalized,
        emailNormalized,
        firstName,
        lastName,
        phone,
        tokenHash: hashOpaqueToken(token),
        expiresAt: new Date(now.getTime() + PATIENT_INVITATION_TTL_MS),
        invitedByUserId: input.invitedByUserId,
        doctorProfileId: input.doctorProfileId,
        clinicProfileId: input.clinicProfileId,
      },
    });
    return { patient: null, invitation, invitationToken: token, isNewInvitation: true };
  } catch (error) {
    if (!(error instanceof Prisma.PrismaClientKnownRequestError) || error.code !== 'P2002') throw error;
    const invitation = await tx.patientInvitation.findFirstOrThrow({ where: { emailNormalized, status: 'PENDING', expiresAt: { gt: now } } });
    return { patient: null, invitation, invitationToken: null, isNewInvitation: false };
  }
}

export async function claimPatientInvitationAppointments(tx: Prisma.TransactionClient, userId: string, emailNormalized: string): Promise<number> {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${emailNormalized}))`;
  const invitations = await tx.patientInvitation.findMany({
    where: { emailNormalized, status: 'PENDING', expiresAt: { gt: new Date() } },
    select: { id: true },
  });
  if (!invitations.length) return 0;
  const invitationIds = invitations.map((item) => item.id);
  const claimed = await tx.appointment.updateMany({
    where: { patientId: null, patientInvitationId: { in: invitationIds }, status: { in: ['PENDING', 'CONFIRMED'] } },
    data: { patientId: userId },
  });
  await tx.patientInvitation.updateMany({ where: { id: { in: invitationIds } }, data: { status: PatientInvitationStatus.ACCEPTED, acceptedAt: new Date() } });
  return claimed.count;
}
