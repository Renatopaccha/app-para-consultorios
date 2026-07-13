import prisma from '../prisma';
import { Role } from '../middlewares/auth.middleware';

export interface AppointmentOwnership {
  patientId: string;
  doctorProfileId: string;
  clinicProfileId: string;
}

/**
 * Verifies resource ownership, not just the role embedded in a JWT.
 * Keep this as the single authorization rule for appointment-private data.
 */
export const canAccessAppointment = async (
  userId: string,
  role: Role,
  appointment: AppointmentOwnership,
): Promise<boolean> => {
  if (role === 'SUPER_ADMIN') return true;
  if (role === 'PATIENT') return appointment.patientId === userId;

  if (role === 'DOCTOR') {
    const doctor = await prisma.doctorProfile.findUnique({
      where: { userId },
      select: { id: true },
    });
    return doctor?.id === appointment.doctorProfileId;
  }

  if (role === 'CLINIC_ADMIN') {
    const clinic = await prisma.clinicProfile.findUnique({
      where: { userId },
      select: { id: true },
    });
    return clinic?.id === appointment.clinicProfileId;
  }

  if (role === 'ASSISTANT') {
    const assistant = await prisma.assistantProfile.findUnique({
      where: { userId },
      select: { doctorProfileId: true, clinicProfileId: true },
    });
    return assistant?.doctorProfileId === appointment.doctorProfileId
      || assistant?.clinicProfileId === appointment.clinicProfileId;
  }

  return false;
};

export const canManageClinic = async (userId: string, role: Role, clinicProfileId: string): Promise<boolean> => {
  if (role === 'SUPER_ADMIN') return true;
  if (role !== 'CLINIC_ADMIN') return false;

  const clinic = await prisma.clinicProfile.findUnique({
    where: { userId },
    select: { id: true },
  });
  return clinic?.id === clinicProfileId;
};
