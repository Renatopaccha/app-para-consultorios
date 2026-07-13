import { Prisma } from '../../generated/prisma';
import prisma from '../prisma';
import { buildServiceSnapshot } from './serviceSnapshot.service';
import { localDate, localDateTimeToUtc, localTime, minutes, parseRequestedStart } from '../utils/scheduling';
import crypto from 'crypto';

export class BookingError extends Error { constructor(public code: string, public status: number, message: string) { super(message); } }
const occupied = ['PENDING', 'CONFIRMED', 'IN_PROGRESS'] as const;

export async function createAppointment(input: { patientUserId: string; doctorId: string; clinicId: string; serviceId: string; requestedStart: unknown; paymentMethod?: string }) {
  const startsAt = parseRequestedStart(input.requestedStart);
  if (startsAt <= new Date()) throw new BookingError('INVALID_START', 400, 'El horario debe ser futuro.');
  try {
    return await prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${input.doctorId}))`;
      const [patient, doctor, clinic, service, workplace] = await Promise.all([
        tx.user.findUnique({ where: { id: input.patientUserId } }),
        tx.doctorProfile.findUnique({ where: { id: input.doctorId } }), tx.clinicProfile.findUnique({ where: { id: input.clinicId } }),
        tx.service.findUnique({ where: { id: input.serviceId } }),
        tx.doctorClinicWorkplace.findUnique({ where: { doctorProfileId_clinicProfileId: { doctorProfileId: input.doctorId, clinicProfileId: input.clinicId } } }),
      ]);
      if (!patient || patient.role !== 'PATIENT') throw new BookingError('PATIENT_NOT_FOUND', 404, 'Paciente no encontrado.');
      if (!doctor || doctor.verificationStatus !== 'APPROVED') throw new BookingError('DOCTOR_NOT_AVAILABLE', 404, 'Doctor no disponible.');
      if (!clinic || clinic.verificationStatus !== 'APPROVED' || !workplace?.isActive) throw new BookingError('CLINIC_NOT_AVAILABLE', 404, 'Clínica no disponible.');
      if (!service || !service.isActive) throw new BookingError('SERVICE_NOT_AVAILABLE', 404, 'Servicio no disponible.');
      if (service.doctorProfileId !== doctor.id && service.clinicProfileId !== clinic.id) throw new BookingError('SERVICE_NOT_COMPATIBLE', 403, 'El servicio no pertenece al médico o clínica.');
      const snapshot = buildServiceSnapshot(service); const endsAt = new Date(startsAt.getTime() + snapshot.serviceDurationMinutesSnapshot * 60_000);
      if (localDate(startsAt) !== localDate(endsAt)) throw new BookingError('OUTSIDE_WORKING_HOURS', 422, 'El servicio cruza el final de la jornada.');
      const weekday = (startsAt.getUTCDay() + 6) % 7;
      const schedules = await tx.workSchedule.findMany({ where: { workplaceId: workplace.id, weekday } });
      const withinSchedule = schedules.some(s => minutes(localTime(startsAt)) >= minutes(s.startTime) && minutes(localTime(endsAt)) <= minutes(s.endTime));
      if (!withinSchedule) throw new BookingError('OUTSIDE_WORKING_HOURS', 422, 'El horario está fuera de la jornada.');
      const block = await tx.scheduleBlock.findFirst({ where: { doctorProfileId: doctor.id, startsAt: { lt: endsAt }, endsAt: { gt: startsAt } } });
      if (block) throw new BookingError('APPOINTMENT_TIME_CONFLICT', 409, 'El horario seleccionado ya no está disponible.');
      const paymentMethod = input.paymentMethod === 'CASH' ? 'CASH' : 'NONE';
      return tx.appointment.create({ data: { patientId: patient.id, doctorProfileId: doctor.id, clinicProfileId: clinic.id, serviceId: service.id, date: localDateTimeToUtc(localDate(startsAt), '00:00'), startTime: localTime(startsAt), endTime: localTime(endsAt), startDatetime: startsAt, startsAt, endsAt, status: paymentMethod === 'NONE' || snapshot.servicePriceCentsSnapshot === 0 ? 'CONFIRMED' : 'PENDING', paymentMethod, paymentStatus: paymentMethod === 'CASH' ? 'PENDING_CASH' : 'PAID', verificationCode: paymentMethod === 'CASH' ? crypto.randomBytes(3).toString('hex').toUpperCase() : null, ...snapshot } });
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
  } catch (error) {
    if (error instanceof BookingError) throw error;
    if (error instanceof Prisma.PrismaClientKnownRequestError || String(error).includes('Appointment_no_active_doctor_overlap') || String(error).includes('23P01')) throw new BookingError('APPOINTMENT_TIME_CONFLICT', 409, 'El horario seleccionado ya no está disponible.');
    throw error;
  }
}

export async function cancelAppointment(appointmentId: string, actorId: string, reason?: string) {
  return prisma.$transaction(async tx => {
    const appointment = await tx.appointment.findUnique({ where: { id: appointmentId } });
    if (!appointment) throw new BookingError('APPOINTMENT_NOT_FOUND', 404, 'Cita no encontrada.');
    if (appointment.patientId !== actorId && (await tx.doctorProfile.findUnique({ where: { id: appointment.doctorProfileId } }))?.userId !== actorId) throw new BookingError('FORBIDDEN', 403, 'No tienes permisos.');
    if (appointment.status === 'CANCELLED') return appointment;
    const updated = await tx.appointment.update({ where: { id: appointment.id }, data: { status: 'CANCELLED', cancelledAt: new Date(), cancelledByUserId: actorId, cancellationReason: reason || null } });
    await tx.appointmentChangeLog.create({ data: { appointmentId, changedByUserId: actorId, changeType: 'CANCELLED', previousStartsAt: appointment.startsAt, previousEndsAt: appointment.endsAt, newStartsAt: appointment.startsAt, newEndsAt: appointment.endsAt, previousStatus: appointment.status, newStatus: 'CANCELLED', reason: reason || null } });
    return updated;
  });
}

export async function rescheduleAppointment(appointmentId: string, actorId: string, requestedStart: unknown) {
  const startsAt = parseRequestedStart(requestedStart);
  try { return await prisma.$transaction(async tx => {
    const appointment = await tx.appointment.findUnique({ where: { id: appointmentId } });
    if (!appointment) throw new BookingError('APPOINTMENT_NOT_FOUND', 404, 'Cita no encontrada.');
    const doctor = await tx.doctorProfile.findUnique({ where: { id: appointment.doctorProfileId } });
    if (appointment.patientId !== actorId && doctor?.userId !== actorId) throw new BookingError('FORBIDDEN', 403, 'No tienes permisos.');
    if (appointment.status === 'CANCELLED' || appointment.status === 'COMPLETED' || !appointment.serviceDurationMinutesSnapshot) throw new BookingError('RESCHEDULE_NOT_ALLOWED', 422, 'La cita no puede reprogramarse.');
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${appointment.doctorProfileId}))`;
    const endsAt = new Date(startsAt.getTime() + appointment.serviceDurationMinutesSnapshot * 60_000);
    const workplace = await tx.doctorClinicWorkplace.findUnique({ where: { doctorProfileId_clinicProfileId: { doctorProfileId: appointment.doctorProfileId, clinicProfileId: appointment.clinicProfileId } } });
    const weekday = (startsAt.getUTCDay() + 6) % 7; const schedules = workplace ? await tx.workSchedule.findMany({ where: { workplaceId: workplace.id, weekday } }) : [];
    if (localDate(startsAt) !== localDate(endsAt) || !schedules.some(s => minutes(localTime(startsAt)) >= minutes(s.startTime) && minutes(localTime(endsAt)) <= minutes(s.endTime))) throw new BookingError('OUTSIDE_WORKING_HOURS', 422, 'El horario está fuera de la jornada.');
    if (await tx.scheduleBlock.findFirst({ where: { doctorProfileId: appointment.doctorProfileId, startsAt: { lt: endsAt }, endsAt: { gt: startsAt } } })) throw new BookingError('APPOINTMENT_TIME_CONFLICT', 409, 'El horario seleccionado ya no está disponible.');
    const updated = await tx.appointment.update({ where: { id: appointment.id }, data: { previousStartsAt: appointment.startsAt, previousEndsAt: appointment.endsAt, startsAt, endsAt, startDatetime: startsAt, date: localDateTimeToUtc(localDate(startsAt), '00:00'), startTime: localTime(startsAt), endTime: localTime(endsAt) } });
    await tx.appointmentChangeLog.create({ data: { appointmentId, changedByUserId: actorId, changeType: 'RESCHEDULED', previousStartsAt: appointment.startsAt, previousEndsAt: appointment.endsAt, newStartsAt: startsAt, newEndsAt: endsAt, previousStatus: appointment.status, newStatus: appointment.status } }); return updated;
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable }); } catch (error) { if (error instanceof BookingError) throw error; if (String(error).includes('Appointment_no_active_doctor_overlap') || String(error).includes('23P01')) throw new BookingError('APPOINTMENT_TIME_CONFLICT', 409, 'El horario seleccionado ya no está disponible.'); throw error; }
}
