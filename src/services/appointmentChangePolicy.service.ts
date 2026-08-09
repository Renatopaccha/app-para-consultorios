import { BookingError } from './appointmentBooking.service';

export const DOCTOR_CANCELLATION_REASONS = ['DOCTOR_UNAVAILABLE', 'CLINIC_CLOSED', 'EMERGENCY', 'OTHER'] as const;
export type DoctorCancellationReason = typeof DOCTOR_CANCELLATION_REASONS[number];

export function doctorAppointmentChangeMinHours(): number {
  const parsed = Number(process.env.DOCTOR_APPOINTMENT_CHANGE_MIN_HOURS ?? 24);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : 24;
}

export function assertDoctorMayChangeAppointment(startsAt: Date | null): void {
  if (!startsAt) throw new BookingError('APPOINTMENT_CHANGE_NOT_ALLOWED', 422, 'La cita no tiene un horario válido.');
  const minimum = doctorAppointmentChangeMinHours() * 60 * 60_000;
  if (startsAt.getTime() - Date.now() < minimum) {
    throw new BookingError('DOCTOR_CHANGE_WINDOW_CLOSED', 422, `Los cambios médicos requieren al menos ${doctorAppointmentChangeMinHours()} horas de anticipación.`);
  }
}

export function isDoctorCancellationReason(value: unknown): value is DoctorCancellationReason {
  return typeof value === 'string' && (DOCTOR_CANCELLATION_REASONS as readonly string[]).includes(value);
}
