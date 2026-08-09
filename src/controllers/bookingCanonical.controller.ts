import { Response } from 'express';
import prisma from '../prisma';
import { AuthRequest } from '../middlewares/auth.middleware';
import { BookingError, createAppointment } from '../services/appointmentBooking.service';
import { cancelAppointment, rescheduleAppointment } from '../services/appointmentBooking.service';
import { confirmPatientAppointment } from '../services/appointmentConfirmation.service';
import { getAppointmentCalendarPresentation } from '../services/appointmentCalendarPresentation.service';
import { localDateTimeToUtc, localDate, localTime, localWeekday, minutes } from '../utils/scheduling';
import { isDoctorCancellationReason } from '../services/appointmentChangePolicy.service';
import { activeScheduleBlockWhere } from '../domain/scheduleBlockState';

function respond(error: unknown, res: Response) {
  if (error instanceof BookingError) return res.status(error.status).json({ error: error.code, message: error.message });
  console.error('[Booking]', error); return res.status(500).json({ error: 'INTERNAL_ERROR', message: 'No se pudo procesar la reserva.' });
}
export async function bookCanonical(req: AuthRequest, res: Response) {
  if (!req.user) return res.status(401).json({ error: 'UNAUTHORIZED' });
  try { const { doctorId, clinicId, serviceId, startsAt, date, startTime, paymentMethod } = req.body; const requestedStart = startsAt || (date && startTime ? `${date}T${startTime}` : undefined); const appointment = await createAppointment({ patientUserId: req.user.id, doctorId, clinicId, serviceId, requestedStart, paymentMethod }); return res.status(201).json(appointment); } catch (error) { return respond(error, res); }
}
export async function getAvailability(req: AuthRequest, res: Response) {
  try {
    const { doctorId, clinicId, serviceId, date } = req.query as Record<string, string>;
    if (!doctorId || !clinicId || !serviceId || !/^\d{4}-\d{2}-\d{2}$/.test(date || '')) return res.status(400).json({ error: 'INVALID_INPUT' });
    const requestedDate = date as string;
    const [doctor, clinic, service, workplace] = await Promise.all([prisma.doctorProfile.findUnique({ where: { id: doctorId } }), prisma.clinicProfile.findUnique({ where: { id: clinicId } }), prisma.service.findUnique({ where: { id: serviceId } }), prisma.doctorClinicWorkplace.findUnique({ where: { doctorProfileId_clinicProfileId: { doctorProfileId: doctorId, clinicProfileId: clinicId } } })]);
    if (!doctor || doctor.verificationStatus !== 'APPROVED' || !clinic || clinic.verificationStatus !== 'APPROVED' || !workplace?.isActive || !service?.isActive || (service.doctorProfileId !== doctorId && service.clinicProfileId !== clinicId) || !service.duration) return res.json({ date, timezone: 'America/Guayaquil', serviceDurationMinutes: service?.duration || null, slots: [] });
    const dayStart = localDateTimeToUtc(requestedDate, '00:00'); const dayEnd = new Date(dayStart.getTime() + 24 * 60 * 60_000); const weekday = localWeekday(dayStart);
    const [schedules, appointments, blocks] = await Promise.all([prisma.workSchedule.findMany({ where: { workplaceId: workplace.id, weekday } }), prisma.appointment.findMany({ where: { doctorProfileId: doctorId, startsAt: { lt: dayEnd }, endsAt: { gt: dayStart }, status: { in: ['PENDING', 'CONFIRMED', 'IN_PROGRESS'] } } }), prisma.scheduleBlock.findMany({ where: activeScheduleBlockWhere({ doctorProfileId: doctorId, startsAt: { lt: dayEnd }, endsAt: { gt: dayStart } }) })]);
    const step = Number(process.env.BOOKING_SLOT_STEP_MINUTES || 15); const minAdvance = Number(process.env.BOOKING_MIN_ADVANCE_MINUTES || 30); const maxDays = Number(process.env.BOOKING_MAX_ADVANCE_DAYS || 90); const now = new Date(); const slots: Array<{ startsAt: string; endsAt: string }> = [];
    for (const schedule of schedules) for (let cursor = minutes(schedule.startTime); cursor + service.duration <= minutes(schedule.endTime); cursor += step) { const start = localDateTimeToUtc(requestedDate, `${String(Math.floor(cursor / 60)).padStart(2, '0')}:${String(cursor % 60).padStart(2, '0')}`); const end = new Date(start.getTime() + service.duration * 60_000); if (start.getTime() < now.getTime() + minAdvance * 60_000 || start.getTime() > now.getTime() + maxDays * 86400_000) continue; if (appointments.some(a => a.startsAt && a.endsAt && start < a.endsAt && end > a.startsAt) || blocks.some(b => start < b.endsAt && end > b.startsAt)) continue; slots.push({ startsAt: start.toISOString(), endsAt: end.toISOString() }); }
    return res.json({ date: requestedDate, timezone: 'America/Guayaquil', serviceDurationMinutes: service.duration, slots });
  } catch (error) { return respond(error, res); }
}
export async function cancelCanonical(req: AuthRequest, res: Response) {
  if (!req.user) return res.status(401).json({ error: 'UNAUTHORIZED' });
  const { reasonCode, internalNote, patientMessage, reason } = req.body as Record<string, unknown>;
  if (req.user.role === 'DOCTOR' && !isDoctorCancellationReason(reasonCode)) return res.status(422).json({ error: 'INVALID_CANCELLATION_REASON', message: 'Selecciona un motivo de cancelación válido.' });
  if ((internalNote !== undefined && typeof internalNote !== 'string') || (patientMessage !== undefined && typeof patientMessage !== 'string')) return res.status(422).json({ error: 'INVALID_INPUT', message: 'Las notas deben ser texto.' });
  try { return res.json(await cancelAppointment(String(req.params.id), req.user.id, { actorRole: req.user.role, reason: typeof reason === 'string' ? reason : undefined, reasonCode: isDoctorCancellationReason(reasonCode) ? reasonCode : undefined, internalNote: typeof internalNote === 'string' ? internalNote.slice(0, 1000) : null, patientMessage: typeof patientMessage === 'string' ? patientMessage.slice(0, 500) : null })); } catch (error) { return respond(error, res); }
}
export async function rescheduleCanonical(req: AuthRequest, res: Response) {
  if (!req.user) return res.status(401).json({ error: 'UNAUTHORIZED' });
  const { startsAt, expectedUpdatedAt, reason, patientMessage } = req.body as Record<string, unknown>;
  if (req.user.role === 'DOCTOR' && (typeof reason !== 'string' || !reason.trim())) return res.status(422).json({ error: 'RESCHEDULE_REASON_REQUIRED', message: 'Indica el motivo de la reprogramación.' });
  if ((expectedUpdatedAt !== undefined && typeof expectedUpdatedAt !== 'string') || (patientMessage !== undefined && typeof patientMessage !== 'string')) return res.status(422).json({ error: 'INVALID_INPUT', message: 'Los datos de reprogramación no son válidos.' });
  try { return res.json(await rescheduleAppointment(String(req.params.id), req.user.id, startsAt, { actorRole: req.user.role, expectedUpdatedAt: typeof expectedUpdatedAt === 'string' ? expectedUpdatedAt : undefined, reason: typeof reason === 'string' ? reason.slice(0, 1000) : null, patientMessage: typeof patientMessage === 'string' ? patientMessage.slice(0, 500) : null })); } catch (error) { return respond(error, res); }
}
export async function confirmCanonical(req: AuthRequest, res: Response) { if (!req.user) return res.status(401).json({ error: 'UNAUTHORIZED' }); try { return res.json(await confirmPatientAppointment(String(req.params.id), req.user.id)); } catch (error) { return respond(error, res); } }
/** Legacy alias kept for older mobile clients. Canonical route: PATCH /api/bookings/:id/confirm. */
export async function confirmAttendanceLegacy(req: AuthRequest, res: Response) { res.setHeader('Deprecation', 'true'); res.setHeader('Link', '</api/bookings/:id/confirm>; rel="successor-version"'); return confirmCanonical(req, res); }
export function calendarPresentation(appointment: { status: string; patientConfirmationStatus: string; paymentStatus: string; cashPayment?: { status: string } | null }) { return getAppointmentCalendarPresentation(appointment); }
