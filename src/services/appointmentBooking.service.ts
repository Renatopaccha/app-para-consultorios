import { Prisma } from '../../generated/prisma';
import prisma from '../prisma';
import { buildServiceSnapshot } from './serviceSnapshot.service';
import { localDate, localDateTimeToUtc, localTime, minutes, parseRequestedStart } from '../utils/scheduling';
import { confirmationDeadline } from './appointmentConfirmation.service';
import { cancelCashPaymentForAppointment, createCashPaymentForAppointment, rescheduleCashPaymentForAppointment } from './cashPayment.service';
import { emailService } from './email.service';

export class BookingError extends Error { constructor(public code: string, public status: number, message: string) { super(message); } }
const occupied = ['PENDING', 'CONFIRMED', 'IN_PROGRESS'] as const;

export async function createAppointment(input: { patientUserId: string; doctorId: string; clinicId: string; serviceId: string; requestedStart: unknown; paymentMethod?: string }) {
  const startsAt = parseRequestedStart(input.requestedStart);
  if (startsAt <= new Date()) throw new BookingError('INVALID_START', 400, 'El horario debe ser futuro.');
  try {
    const result = await prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${input.doctorId}))`;
      const [patient, doctor, clinic, service, workplace] = await Promise.all([
        tx.user.findUnique({ where: { id: input.patientUserId } }),
        tx.doctorProfile.findUnique({ where: { id: input.doctorId }, include: { user: { select: { firstName: true, lastName: true } } } }), tx.clinicProfile.findUnique({ where: { id: input.clinicId } }),
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
      const paymentMethod = input.paymentMethod === 'CASH' && snapshot.servicePriceCentsSnapshot > 0 ? 'CASH' : 'NONE';
      const appointment = await tx.appointment.create({ data: { patientId: patient.id, doctorProfileId: doctor.id, clinicProfileId: clinic.id, serviceId: service.id, date: localDateTimeToUtc(localDate(startsAt), '00:00'), startTime: localTime(startsAt), endTime: localTime(endsAt), startDatetime: startsAt, startsAt, endsAt, confirmationDeadlineAt: confirmationDeadline(startsAt), status: paymentMethod === 'NONE' ? 'CONFIRMED' : 'PENDING', paymentMethod, paymentStatus: paymentMethod === 'CASH' ? 'PENDING_CASH' : 'PAID', verificationCode: null, ...snapshot } });
      if (paymentMethod !== 'CASH') return { appointment, cashPayment: null, code: null, email: null };
      const createdPayment = await createCashPaymentForAppointment(tx, appointment);
      return { appointment, cashPayment: { id: createdPayment.payment.id, status: createdPayment.payment.status, amountCents: createdPayment.payment.amountCents, currency: createdPayment.payment.currency, codeExpiresAt: createdPayment.payment.codeExpiresAt }, code: createdPayment.code, email: { to: patient.email, doctorName: `${doctor.user.firstName} ${doctor.user.lastName}`.trim(), clinicName: clinic.name, serviceName: snapshot.serviceNameSnapshot, startsAt, amountCents: createdPayment.payment.amountCents, currency: createdPayment.payment.currency } };
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
    if (result.email && result.code) await emailService.sendCashPaymentCodeEmail({ ...result.email, code: result.code }).catch(() => undefined);
    return { ...result.appointment, cashPayment: result.cashPayment, cashPaymentCode: result.code };
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
    await cancelCashPaymentForAppointment(tx, appointmentId, actorId, appointment.clinicProfileId, reason);
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
    const changed = await tx.appointment.updateMany({ where: { id: appointment.id, startsAt: appointment.startsAt, endsAt: appointment.endsAt }, data: { previousStartsAt: appointment.startsAt, previousEndsAt: appointment.endsAt, startsAt, endsAt, startDatetime: startsAt, date: localDateTimeToUtc(localDate(startsAt), '00:00'), startTime: localTime(startsAt), endTime: localTime(endsAt) } });
    if (changed.count !== 1) throw new BookingError('APPOINTMENT_TIME_CONFLICT', 409, 'La cita fue modificada simultáneamente.');
    const updated = await tx.appointment.findUniqueOrThrow({ where: { id: appointment.id } });
    await tx.appointmentChangeLog.create({ data: { appointmentId, changedByUserId: actorId, changeType: 'RESCHEDULED', previousStartsAt: appointment.startsAt, previousEndsAt: appointment.endsAt, newStartsAt: startsAt, newEndsAt: endsAt, previousStatus: appointment.status, newStatus: appointment.status } });
    await rescheduleCashPaymentForAppointment(tx, appointmentId, endsAt, actorId, appointment.clinicProfileId);
    return updated;
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable }); } catch (error) { if (error instanceof BookingError) throw error; if ((error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2034') || String(error).includes('Appointment_no_active_doctor_overlap') || String(error).includes('23P01')) throw new BookingError('APPOINTMENT_TIME_CONFLICT', 409, 'El horario seleccionado ya no está disponible.'); throw error; }
}
