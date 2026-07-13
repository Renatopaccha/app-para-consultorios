import prisma from '../prisma';
import { BookingError } from './appointmentBooking.service';

export function confirmationDeadline(startsAt: Date): Date {
  const cutoff = Number(process.env.APPOINTMENT_CONFIRMATION_CUTOFF_HOURS || 12) * 3600_000;
  const lastMinute = Number(process.env.LAST_MINUTE_CONFIRMATION_WINDOW_MINUTES || 15) * 60_000;
  return new Date(Math.max(startsAt.getTime() - cutoff, Date.now() + lastMinute));
}
export async function confirmPatientAppointment(id: string, userId: string) {
  return prisma.$transaction(async tx => {
    const appointment = await tx.appointment.findUnique({ where: { id } });
    if (!appointment) throw new BookingError('APPOINTMENT_NOT_FOUND', 404, 'Cita no encontrada.');
    if (appointment.patientId !== userId) throw new BookingError('FORBIDDEN', 403, 'No tienes permisos.');
    if (['CANCELLED', 'COMPLETED'].includes(appointment.status) || appointment.patientConfirmationStatus === 'EXPIRED') throw new BookingError('CONFIRMATION_NOT_ALLOWED', 422, 'La cita no puede confirmarse.');
    const updated = await tx.appointment.update({ where: { id }, data: { isPatientConfirmed: true, patientConfirmationStatus: 'CONFIRMED', patientConfirmedAt: new Date() } });
    await tx.appointmentChangeLog.create({ data: { appointmentId: id, changedByUserId: userId, changeType: 'STATUS_CHANGED', previousStatus: appointment.status, newStatus: appointment.status, reason: 'PATIENT_CONFIRMED' } });
    return updated;
  });
}

/** Idempotent worker entry point; payment state is deliberately ignored. */
export async function expirePendingConfirmations(now = new Date()): Promise<number> {
  const expired = await prisma.appointment.findMany({ where: { patientConfirmationStatus: 'PENDING', confirmationDeadlineAt: { lte: now }, status: { in: ['PENDING', 'CONFIRMED'] } } });
  let count = 0;
  for (const appointment of expired) {
    const changed = await prisma.$transaction(async tx => {
      const updated = await tx.appointment.updateMany({ where: { id: appointment.id, patientConfirmationStatus: 'PENDING', status: { in: ['PENDING', 'CONFIRMED'] } }, data: { status: 'CANCELLED', patientConfirmationStatus: 'EXPIRED', cancelledAt: now, cancellationReason: 'PATIENT_CONFIRMATION_EXPIRED' } });
      if (updated.count !== 1) return false;
      await tx.appointmentChangeLog.create({ data: { appointmentId: appointment.id, changedByUserId: 'system', changeType: 'CANCELLED', previousStartsAt: appointment.startsAt, previousEndsAt: appointment.endsAt, newStartsAt: appointment.startsAt, newEndsAt: appointment.endsAt, previousStatus: appointment.status, newStatus: 'CANCELLED', reason: 'PATIENT_CONFIRMATION_EXPIRED' } });
      return true;
    });
    if (changed) count++;
  }
  return count;
}
