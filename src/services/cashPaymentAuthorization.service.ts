import { Prisma } from '../../generated/prisma';
import prisma from '../prisma';
import { Role } from '../middlewares/auth.middleware';
import { BookingError } from './appointmentBooking.service';

export type PaymentActor = { id: string; role: Role };

export async function paymentAppointmentScope(actor: PaymentActor, requireFinance = false): Promise<Prisma.AppointmentWhereInput> {
  if (actor.role === 'SUPER_ADMIN') return {};
  if (actor.role === 'DOCTOR') {
    const profile = await prisma.doctorProfile.findUnique({ where: { userId: actor.id }, select: { id: true } });
    if (!profile) throw new BookingError('FORBIDDEN', 403, 'No tienes permisos.');
    return { doctorProfileId: profile.id };
  }
  if (actor.role === 'CLINIC_ADMIN') {
    const profile = await prisma.clinicProfile.findUnique({ where: { userId: actor.id }, select: { id: true } });
    if (!profile) throw new BookingError('FORBIDDEN', 403, 'No tienes permisos.');
    return { clinicProfileId: profile.id };
  }
  if (actor.role === 'ASSISTANT') {
    const profile = await prisma.assistantProfile.findUnique({ where: { userId: actor.id }, select: { doctorProfileId: true, clinicProfileId: true, canViewFinances: true } });
    if (!profile || (requireFinance && !profile.canViewFinances)) throw new BookingError('FORBIDDEN', 403, 'No tienes permisos.');
    const OR: Prisma.AppointmentWhereInput[] = [];
    if (profile.doctorProfileId) OR.push({ doctorProfileId: profile.doctorProfileId });
    if (profile.clinicProfileId) OR.push({ clinicProfileId: profile.clinicProfileId });
    if (!OR.length) throw new BookingError('FORBIDDEN', 403, 'No tienes permisos.');
    return { OR };
  }
  throw new BookingError('FORBIDDEN', 403, 'No tienes permisos.');
}
