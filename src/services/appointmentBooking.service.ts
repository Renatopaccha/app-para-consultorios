import { Prisma } from '../../generated/prisma';
import prisma from '../prisma';
import { buildServiceSnapshot } from './serviceSnapshot.service';
import { localDate, localDateTimeToUtc, localTime, localWeekday, minutes, parseRequestedStart } from '../utils/scheduling';
import { confirmationDeadline } from './appointmentConfirmation.service';
import { cancelCashPaymentForAppointment, createCashPaymentForAppointment, rescheduleCashPaymentForAppointment } from './cashPayment.service';
import { emailService } from './email.service';
import { resolvePatientInvitation, type InvitedPatientInput } from './patientInvitation.service';
import { assertDoctorMayChangeAppointment, type DoctorCancellationReason } from './appointmentChangePolicy.service';
import { activeScheduleBlockWhere } from '../domain/scheduleBlockState';
import { enqueueNotification } from './notificationOutbox.service';

export class BookingError extends Error { constructor(public code: string, public status: number, message: string) { super(message); } }
const occupied = ['PENDING', 'CONFIRMED', 'IN_PROGRESS'] as const;

export async function createAppointment(input: { patientUserId?: string; invitedPatient?: Omit<InvitedPatientInput, 'doctorProfileId' | 'clinicProfileId'>; doctorId: string; clinicId: string; serviceId: string; requestedStart: unknown; paymentMethod?: string }) {
  const startsAt = parseRequestedStart(input.requestedStart);
  if (startsAt <= new Date()) throw new BookingError('INVALID_START', 400, 'El horario debe ser futuro.');
  try {
    const result = await prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${input.doctorId}))`;
      const [registeredPatient, doctor, clinic, service, workplace] = await Promise.all([
        input.patientUserId ? tx.user.findUnique({ where: { id: input.patientUserId } }) : Promise.resolve(null),
        tx.doctorProfile.findUnique({ where: { id: input.doctorId }, include: { user: { select: { firstName: true, lastName: true } } } }), tx.clinicProfile.findUnique({ where: { id: input.clinicId } }),
        tx.service.findUnique({ where: { id: input.serviceId } }),
        tx.doctorClinicWorkplace.findUnique({ where: { doctorProfileId_clinicProfileId: { doctorProfileId: input.doctorId, clinicProfileId: input.clinicId } } }),
      ]);
      if (input.patientUserId && (!registeredPatient || registeredPatient.role !== 'PATIENT')) throw new BookingError('PATIENT_NOT_FOUND', 404, 'Paciente no encontrado.');
      if (!doctor || doctor.verificationStatus !== 'APPROVED') throw new BookingError('DOCTOR_NOT_AVAILABLE', 404, 'Doctor no disponible.');
      if (!clinic || clinic.verificationStatus !== 'APPROVED' || !workplace?.isActive) throw new BookingError('CLINIC_NOT_AVAILABLE', 404, 'Clínica no disponible.');
      if (!service || !service.isActive) throw new BookingError('SERVICE_NOT_AVAILABLE', 404, 'Servicio no disponible.');
      if (service.doctorProfileId !== doctor.id && service.clinicProfileId !== clinic.id) throw new BookingError('SERVICE_NOT_COMPATIBLE', 403, 'El servicio no pertenece al médico o clínica.');
      const patientResolution = registeredPatient
        ? { patient: registeredPatient, invitation: null, invitationToken: null, isNewInvitation: false }
        : input.invitedPatient
          ? await resolvePatientInvitation(tx, { ...input.invitedPatient, doctorProfileId: doctor.id, clinicProfileId: clinic.id })
          : (() => { throw new BookingError('INVALID_PATIENT', 400, 'Selecciona un paciente o ingresa sus datos.'); })();
      const snapshot = buildServiceSnapshot(service); const endsAt = new Date(startsAt.getTime() + snapshot.serviceDurationMinutesSnapshot * 60_000);
      if (localDate(startsAt) !== localDate(endsAt)) throw new BookingError('OUTSIDE_WORKING_HOURS', 422, 'El servicio cruza el final de la jornada.');
      const weekday = localWeekday(startsAt);
      const schedules = await tx.workSchedule.findMany({ where: { workplaceId: workplace.id, weekday } });
      const withinSchedule = schedules.some(s => minutes(localTime(startsAt)) >= minutes(s.startTime) && minutes(localTime(endsAt)) <= minutes(s.endTime));
      if (!withinSchedule) throw new BookingError('OUTSIDE_WORKING_HOURS', 422, 'El horario está fuera de la jornada.');
      const block = await tx.scheduleBlock.findFirst({ where: activeScheduleBlockWhere({ doctorProfileId: doctor.id, startsAt: { lt: endsAt }, endsAt: { gt: startsAt } }) });
      if (block) throw new BookingError('APPOINTMENT_TIME_CONFLICT', 409, 'El horario seleccionado ya no está disponible.');
      const paymentMethod = input.paymentMethod === 'CASH' && snapshot.servicePriceCentsSnapshot > 0 ? 'CASH' : 'NONE';
      const appointment = await tx.appointment.create({ data: { patientId: patientResolution.patient?.id ?? null, patientInvitationId: patientResolution.invitation?.id ?? null, invitedPatientFirstName: patientResolution.invitation?.firstName ?? null, invitedPatientLastName: patientResolution.invitation?.lastName ?? null, invitedPatientEmail: patientResolution.invitation?.email ?? null, invitedPatientPhone: patientResolution.invitation?.phone ?? null, doctorProfileId: doctor.id, clinicProfileId: clinic.id, serviceId: service.id, date: localDateTimeToUtc(localDate(startsAt), '00:00'), startTime: localTime(startsAt), endTime: localTime(endsAt), startDatetime: startsAt, startsAt, endsAt, confirmationDeadlineAt: confirmationDeadline(startsAt), status: paymentMethod === 'NONE' ? 'CONFIRMED' : 'PENDING', paymentMethod, paymentStatus: paymentMethod === 'CASH' ? 'PENDING_CASH' : 'PAID', verificationCode: null, ...snapshot } });
      const recipient = patientResolution.patient
        ? { email: patientResolution.patient.email, firstName: patientResolution.patient.firstName, invitationToken: null, invitationExpiresAt: null, isNewInvitation: false }
        : { email: patientResolution.invitation!.email, firstName: patientResolution.invitation!.firstName, invitationToken: patientResolution.invitationToken, invitationExpiresAt: patientResolution.invitation!.expiresAt, isNewInvitation: patientResolution.isNewInvitation };
      await enqueueNotification(tx, { eventType: 'APPOINTMENT_CREATED', aggregateId: appointment.id, deduplicationKey: `appointment:${appointment.id}:created` });
      await enqueueNotification(tx, { eventType: 'APPOINTMENT_CONFIRMATION_REQUIRED', aggregateId: appointment.id, deduplicationKey: `appointment:${appointment.id}:confirmation-required` });
      if (patientResolution.invitationToken && patientResolution.isNewInvitation) await enqueueNotification(tx, { eventType: 'PATIENT_INVITED', aggregateId: appointment.id, deduplicationKey: `patient-invitation:${patientResolution.invitation!.id}`, secret: { token: patientResolution.invitationToken } });
      if (paymentMethod !== 'CASH') return { appointment, cashPayment: null, code: null, email: null, recipient };
      if (!patientResolution.patient) throw new BookingError('GUEST_CASH_PAYMENT_NOT_SUPPORTED', 422, 'Una cita invitada no puede usar pago en efectivo hasta que el paciente cree su cuenta.');
      const createdPayment = await createCashPaymentForAppointment(tx, appointment);
      return { appointment, cashPayment: { id: createdPayment.payment.id, status: createdPayment.payment.status, amountCents: createdPayment.payment.amountCents, currency: createdPayment.payment.currency, codeExpiresAt: createdPayment.payment.codeExpiresAt }, code: createdPayment.code, email: { to: patientResolution.patient.email, doctorName: `${doctor.user.firstName} ${doctor.user.lastName}`.trim(), clinicName: clinic.name, serviceName: snapshot.serviceNameSnapshot, startsAt, amountCents: createdPayment.payment.amountCents, currency: createdPayment.payment.currency }, recipient };
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
    if (result.email && result.code) await emailService.sendCashPaymentCodeEmail({ ...result.email, code: result.code }).catch(() => undefined);
    return { ...result.appointment, cashPayment: result.cashPayment, cashPaymentCode: result.code, patientRecipient: result.recipient };
  } catch (error) {
    if (error instanceof BookingError) throw error;
    if (error instanceof Prisma.PrismaClientKnownRequestError || String(error).includes('Appointment_no_active_doctor_overlap') || String(error).includes('23P01')) throw new BookingError('APPOINTMENT_TIME_CONFLICT', 409, 'El horario seleccionado ya no está disponible.');
    throw error;
  }
}

export type CancelAppointmentOptions = { reason?: string; actorRole?: string; reasonCode?: DoctorCancellationReason; internalNote?: string | null; patientMessage?: string | null };
export type RescheduleAppointmentOptions = { expectedUpdatedAt?: string; actorRole?: string; reason?: string | null; patientMessage?: string | null };

function auditReason(data: { reasonCode?: string; internalNote?: string | null; patientMessage?: string | null; reason?: string | null }): string | null {
  if (!data.reasonCode && !data.internalNote && !data.patientMessage && !data.reason) return null;
  return JSON.stringify({ reasonCode: data.reasonCode ?? null, internalNote: data.internalNote ?? data.reason ?? null, patientMessage: data.patientMessage ?? null });
}

export async function cancelAppointment(appointmentId: string, actorId: string, options?: CancelAppointmentOptions) {
  return prisma.$transaction(async tx => {
    const appointment = await tx.appointment.findUnique({ where: { id: appointmentId } });
    if (!appointment) throw new BookingError('APPOINTMENT_NOT_FOUND', 404, 'Cita no encontrada.');
    if (appointment.patientId !== actorId && (await tx.doctorProfile.findUnique({ where: { id: appointment.doctorProfileId } }))?.userId !== actorId) throw new BookingError('FORBIDDEN', 403, 'No tienes permisos.');
    if (appointment.status === 'CANCELLED') return appointment;
    if (appointment.status === 'COMPLETED' || appointment.status === 'MISSED' || appointment.status === 'IN_PROGRESS') throw new BookingError('CANCELLATION_NOT_ALLOWED', 422, 'La cita no puede cancelarse en su estado actual.');
    if (options?.actorRole === 'DOCTOR') assertDoctorMayChangeAppointment(appointment.startsAt);
    const reason = auditReason(options ?? {});
    const updated = await tx.appointment.update({ where: { id: appointment.id }, data: { status: 'CANCELLED', cancelledAt: new Date(), cancelledByUserId: actorId, cancellationReason: options?.internalNote ?? options?.reason ?? null, cancellationReasonCode: options?.reasonCode ?? null, cancellationInternalNote: options?.internalNote ?? null, cancellationPatientMessage: options?.patientMessage ?? null } });
    await tx.appointmentChangeLog.create({ data: { appointmentId, changedByUserId: actorId, changeType: 'CANCELLED', previousStartsAt: appointment.startsAt, previousEndsAt: appointment.endsAt, newStartsAt: appointment.startsAt, newEndsAt: appointment.endsAt, previousStatus: appointment.status, newStatus: 'CANCELLED', reason } });
    await cancelCashPaymentForAppointment(tx, appointmentId, actorId, appointment.clinicProfileId, options?.internalNote ?? options?.reason);
    await enqueueNotification(tx, { eventType: 'APPOINTMENT_CANCELLED', aggregateId: appointmentId, deduplicationKey: `appointment:${appointmentId}:cancelled`, payload: { previousStartsAt: appointment.startsAt?.toISOString(), patientMessage: options?.patientMessage ?? null } });
    return updated;
  });
}

export async function rescheduleAppointment(appointmentId: string, actorId: string, requestedStart: unknown, options?: RescheduleAppointmentOptions) {
  const startsAt = parseRequestedStart(requestedStart);
  try { return await prisma.$transaction(async tx => {
    const appointment = await tx.appointment.findUnique({ where: { id: appointmentId } });
    if (!appointment) throw new BookingError('APPOINTMENT_NOT_FOUND', 404, 'Cita no encontrada.');
    const doctor = await tx.doctorProfile.findUnique({ where: { id: appointment.doctorProfileId } });
    if (appointment.patientId !== actorId && doctor?.userId !== actorId) throw new BookingError('FORBIDDEN', 403, 'No tienes permisos.');
    if (appointment.status === 'CANCELLED' || appointment.status === 'COMPLETED' || appointment.status === 'MISSED' || appointment.status === 'IN_PROGRESS' || !appointment.serviceDurationMinutesSnapshot) throw new BookingError('RESCHEDULE_NOT_ALLOWED', 422, 'La cita no puede reprogramarse.');
    if (startsAt <= new Date()) throw new BookingError('INVALID_START', 400, 'El horario debe ser futuro.');
    if (options?.actorRole === 'DOCTOR') assertDoctorMayChangeAppointment(appointment.startsAt);
    let expectedUpdatedAt: Date | undefined;
    if (options?.expectedUpdatedAt) { expectedUpdatedAt = parseRequestedStart(options.expectedUpdatedAt); }
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${appointment.doctorProfileId}))`;
    const endsAt = new Date(startsAt.getTime() + appointment.serviceDurationMinutesSnapshot * 60_000);
    const workplace = await tx.doctorClinicWorkplace.findUnique({ where: { doctorProfileId_clinicProfileId: { doctorProfileId: appointment.doctorProfileId, clinicProfileId: appointment.clinicProfileId } } });
    const weekday = localWeekday(startsAt); const schedules = workplace ? await tx.workSchedule.findMany({ where: { workplaceId: workplace.id, weekday } }) : [];
    if (localDate(startsAt) !== localDate(endsAt) || !schedules.some(s => minutes(localTime(startsAt)) >= minutes(s.startTime) && minutes(localTime(endsAt)) <= minutes(s.endTime))) throw new BookingError('OUTSIDE_WORKING_HOURS', 422, 'El horario está fuera de la jornada.');
    if (await tx.scheduleBlock.findFirst({ where: activeScheduleBlockWhere({ doctorProfileId: appointment.doctorProfileId, startsAt: { lt: endsAt }, endsAt: { gt: startsAt } }) })) throw new BookingError('APPOINTMENT_TIME_CONFLICT', 409, 'El horario seleccionado ya no está disponible.');
    const changed = await tx.appointment.updateMany({ where: { id: appointment.id, startsAt: appointment.startsAt, endsAt: appointment.endsAt, ...(expectedUpdatedAt ? { updatedAt: expectedUpdatedAt } : {}) }, data: { previousStartsAt: appointment.startsAt, previousEndsAt: appointment.endsAt, startsAt, endsAt, startDatetime: startsAt, date: localDateTimeToUtc(localDate(startsAt), '00:00'), startTime: localTime(startsAt), endTime: localTime(endsAt), reminder24hSent: false, reminder2hSent: false, reminder1hSent: false } });
    if (changed.count !== 1) throw new BookingError('APPOINTMENT_STALE', 409, 'La cita fue modificada simultáneamente.');
    const updated = await tx.appointment.findUniqueOrThrow({ where: { id: appointment.id } });
    await tx.appointmentChangeLog.create({ data: { appointmentId, changedByUserId: actorId, changeType: 'RESCHEDULED', previousStartsAt: appointment.startsAt, previousEndsAt: appointment.endsAt, newStartsAt: startsAt, newEndsAt: endsAt, previousStatus: appointment.status, newStatus: appointment.status, reason: auditReason(options ?? {}) } });
    await rescheduleCashPaymentForAppointment(tx, appointmentId, endsAt, actorId, appointment.clinicProfileId);
    await enqueueNotification(tx, { eventType: 'APPOINTMENT_RESCHEDULED', aggregateId: appointmentId, deduplicationKey: `appointment:${appointmentId}:rescheduled:${startsAt.toISOString()}`, payload: { previousStartsAt: appointment.startsAt?.toISOString(), newStartsAt: startsAt.toISOString(), patientMessage: options?.patientMessage ?? null } });
    return updated;
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable }); } catch (error) { if (error instanceof BookingError) throw error; if ((error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2034') || String(error).includes('Appointment_no_active_doctor_overlap') || String(error).includes('23P01')) throw new BookingError('APPOINTMENT_TIME_CONFLICT', 409, 'El horario seleccionado ya no está disponible.'); throw error; }
}
