import prisma from '../prisma';
import { canAccessAppointment } from './appointmentAuthorization.service';
import { BookingError } from './appointmentBooking.service';
import { Role } from '../middlewares/auth.middleware';

/**
 * Compatibility boundary until the Payment aggregate replaces appointment payment fields.
 * TODO: replace with Payment model and auditable cash-payment events.
 */
export async function confirmLegacyCashPayment(verificationCode: string, actor: { id: string; role: Role }) {
  const appointment = await prisma.appointment.findUnique({ where: { verificationCode } });
  if (!appointment) throw new BookingError('CASH_PAYMENT_CODE_NOT_FOUND', 404, 'Código inválido o no encontrado.');
  if (!await canAccessAppointment(actor.id, actor.role, appointment)) throw new BookingError('FORBIDDEN', 403, 'No tienes permisos para verificar el pago de esta cita.');
  if (appointment.paymentMethod !== 'CASH') throw new BookingError('CASH_PAYMENT_NOT_ALLOWED', 422, 'Esta cita no está configurada para pago en efectivo.');
  if (appointment.paymentStatus === 'PAID') throw new BookingError('CASH_PAYMENT_ALREADY_CONFIRMED', 409, 'Esta cita ya fue pagada.');

  // Deliberately updates only payment fields; clinical and confirmation state are untouched.
  const updated = await prisma.appointment.update({ where: { id: appointment.id }, data: { paymentStatus: 'PAID', verificationCode: null } });
  return updated;
}
