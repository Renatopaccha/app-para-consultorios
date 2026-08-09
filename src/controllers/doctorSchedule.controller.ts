import type { Response } from 'express';
import { Prisma } from '../../generated/prisma';
import type { AuthRequest } from '../middlewares/auth.middleware';
import prisma from '../prisma';
import type {
  DoctorWorkScheduleInput,
  SaveDoctorWorkSchedulesInput,
} from '../dtos/schedule.dto';
import { parseCreateDoctorAppointment, parseInvitedPatient } from '../dtos/schedule.dto';
import { BookingError, createAppointment } from '../services/appointmentBooking.service';
import { APP_TIMEZONE, minutes } from '../utils/scheduling';
import { canExposeDevelopmentToken } from '../services/emailIdentity.service';
import { resolvePatientInvitation } from '../services/patientInvitation.service';
import { enqueueNotification } from '../services/notificationOutbox.service';

const TIME_PATTERN = /^([01]\d|2[0-3]):[0-5]\d$/;

function error(res: Response, status: number, code: string, message: string, fields?: Record<string, string>) {
  return res.status(status).json({ error: code, message, ...(fields ? { fields } : {}) });
}

async function ownDoctor(userId: string) {
  return prisma.doctorProfile.findUnique({
    where: { userId },
    include: { user: { select: { firstName: true, lastName: true } } },
  });
}

async function linkedWorkplace(doctorId: string, clinicId: string) {
  const clinic = await prisma.clinicProfile.findUnique({ where: { id: clinicId }, select: { id: true, name: true } });
  if (!clinic) return { clinic: null, workplace: null };
  const workplace = await prisma.doctorClinicWorkplace.findUnique({
    where: { doctorProfileId_clinicProfileId: { doctorProfileId: doctorId, clinicProfileId: clinicId } },
  });
  return { clinic, workplace };
}

function validateSchedules(value: unknown): { schedules?: DoctorWorkScheduleInput[]; fields: Record<string, string> } {
  const fields: Record<string, string> = {};
  if (!Array.isArray(value) || value.length > 70) {
    fields.schedules = 'Envía una lista de máximo 70 intervalos.';
    return { fields };
  }

  const schedules: DoctorWorkScheduleInput[] = [];
  value.forEach((entry, index) => {
    if (!entry || typeof entry !== 'object') {
      fields[`schedules.${index}`] = 'El intervalo no es válido.';
      return;
    }
    const item = entry as Record<string, unknown>;
    if (!Number.isInteger(item.weekday) || Number(item.weekday) < 0 || Number(item.weekday) > 6) {
      fields[`schedules.${index}.weekday`] = 'Usa 0 para lunes y 6 para domingo.';
    }
    if (typeof item.startTime !== 'string' || !TIME_PATTERN.test(item.startTime)) {
      fields[`schedules.${index}.startTime`] = 'Usa el formato HH:mm.';
    }
    if (typeof item.endTime !== 'string' || !TIME_PATTERN.test(item.endTime)) {
      fields[`schedules.${index}.endTime`] = 'Usa el formato HH:mm.';
    }
    if (typeof item.startTime === 'string' && typeof item.endTime === 'string'
      && TIME_PATTERN.test(item.startTime) && TIME_PATTERN.test(item.endTime)
      && minutes(item.startTime) >= minutes(item.endTime)) {
      fields[`schedules.${index}.endTime`] = 'La hora final debe ser posterior a la inicial.';
    }
    schedules.push({
      weekday: Number(item.weekday),
      startTime: String(item.startTime),
      endTime: String(item.endTime),
    });
  });

  if (Object.keys(fields).length > 0) return { fields };
  for (let weekday = 0; weekday <= 6; weekday += 1) {
    const day = schedules
      .filter((item) => item.weekday === weekday)
      .sort((a, b) => minutes(a.startTime) - minutes(b.startTime));
    for (let index = 1; index < day.length; index += 1) {
      if (minutes(day[index]!.startTime) < minutes(day[index - 1]!.endTime)) {
        fields.schedules = `Los intervalos del día ${weekday} se solapan.`;
        break;
      }
    }
  }
  return Object.keys(fields).length > 0 ? { fields } : { schedules, fields };
}

function scheduleDto(schedule: {
  id: string;
  weekday: number;
  timezone: string | null;
  startTime: string;
  endTime: string;
  workplaceId: string;
}) {
  return {
    id: schedule.id,
    weekday: schedule.weekday,
    timezone: schedule.timezone || APP_TIMEZONE,
    startTime: schedule.startTime,
    endTime: schedule.endTime,
    workplaceId: schedule.workplaceId,
  };
}

export async function getMyWorkSchedules(req: AuthRequest, res: Response) {
  const doctor = await ownDoctor(req.user!.id);
  if (!doctor) return error(res, 404, 'DOCTOR_PROFILE_NOT_FOUND', 'No existe un perfil médico para esta sesión.');
  const clinicId = typeof req.query.clinicId === 'string' ? req.query.clinicId.trim() : '';
  if (clinicId) {
    const { clinic, workplace } = await linkedWorkplace(doctor.id, clinicId);
    if (!clinic) return error(res, 404, 'CLINIC_NOT_FOUND', 'La clínica indicada no existe.');
    if (!workplace?.isActive) return error(res, 403, 'CLINIC_NOT_LINKED', 'La clínica no está vinculada activamente a tu perfil.');
  }

  const schedules = await prisma.workSchedule.findMany({
    where: {
      workplace: {
        doctorProfileId: doctor.id,
        isActive: true,
        ...(clinicId ? { clinicProfileId: clinicId } : {}),
      },
    },
    include: { workplace: { include: { clinicProfile: { select: { id: true, name: true } } } } },
    orderBy: [{ weekday: 'asc' }, { startTime: 'asc' }],
  });
  return res.json({
    timezone: APP_TIMEZONE,
    items: schedules.map((schedule) => ({
      ...scheduleDto(schedule),
      clinic: schedule.workplace.clinicProfile,
    })),
  });
}

export async function putMyWorkSchedules(req: AuthRequest, res: Response) {
  const doctor = await ownDoctor(req.user!.id);
  if (!doctor) return error(res, 404, 'DOCTOR_PROFILE_NOT_FOUND', 'No existe un perfil médico para esta sesión.');
  const input = req.body as Partial<SaveDoctorWorkSchedulesInput>;
  if (typeof input.clinicId !== 'string' || !input.clinicId.trim()) {
    return error(res, 400, 'INVALID_INPUT', 'Selecciona una clínica válida.', { clinicId: 'La clínica es obligatoria.' });
  }
  const clinicId = input.clinicId.trim();
  const validated = validateSchedules(input.schedules);
  if (!validated.schedules) return error(res, 400, 'INVALID_WORK_SCHEDULES', 'Revisa los horarios indicados.', validated.fields);

  const { clinic, workplace } = await linkedWorkplace(doctor.id, clinicId);
  if (!clinic) return error(res, 404, 'CLINIC_NOT_FOUND', 'La clínica indicada no existe.');
  if (!workplace?.isActive) return error(res, 403, 'CLINIC_NOT_LINKED', 'La clínica no está vinculada activamente a tu perfil.');

  try {
    const items = await prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${doctor.id}))`;
      const otherSchedules = await tx.workSchedule.findMany({
        where: {
          workplace: { doctorProfileId: doctor.id, isActive: true },
          workplaceId: { not: workplace.id },
        },
      });
      const collision = validated.schedules!.find((candidate) => otherSchedules.some((existing) =>
        existing.weekday === candidate.weekday
        && minutes(candidate.startTime) < minutes(existing.endTime)
        && minutes(candidate.endTime) > minutes(existing.startTime)));
      if (collision) throw new BookingError('WORK_SCHEDULE_CONFLICT', 409, 'El horario se solapa con otra sede vinculada.');

      await tx.workSchedule.deleteMany({ where: { workplaceId: workplace.id } });
      if (validated.schedules!.length > 0) {
        await tx.workSchedule.createMany({
          data: validated.schedules!.map((schedule) => ({
            ...schedule,
            timezone: APP_TIMEZONE,
            workplaceId: workplace.id,
          })),
        });
      }
      return tx.workSchedule.findMany({
        where: { workplaceId: workplace.id },
        orderBy: [{ weekday: 'asc' }, { startTime: 'asc' }],
      });
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
    return res.json({
      clinic,
      timezone: APP_TIMEZONE,
      items: items.map(scheduleDto),
    });
  } catch (caught) {
    if (caught instanceof BookingError) return error(res, caught.status, caught.code, caught.message);
    if (caught instanceof Prisma.PrismaClientKnownRequestError && caught.code === 'P2034') {
      return error(res, 409, 'WORK_SCHEDULE_CONFLICT', 'Los horarios cambiaron simultáneamente. Intenta nuevamente.');
    }
    console.error('[Doctor work schedules]', caught);
    return error(res, 500, 'INTERNAL_ERROR', 'No se pudieron guardar los horarios.');
  }
}

export async function createMyAppointment(req: AuthRequest, res: Response) {
  const doctor = await ownDoctor(req.user!.id);
  if (!doctor) return error(res, 404, 'DOCTOR_PROFILE_NOT_FOUND', 'No existe un perfil médico para esta sesión.');
  const parsed = parseCreateDoctorAppointment(req.body);
  if (!parsed.success) return error(res, 422, 'VALIDATION_ERROR', 'Revisa los datos de la cita.', parsed.fields);
  const { clinicId, serviceId, startsAt, sendEmail, patient } = parsed.data;
  const { clinic, workplace } = await linkedWorkplace(doctor.id, clinicId);
  if (!clinic) return error(res, 404, 'CLINIC_NOT_FOUND', 'La clínica indicada no existe.');
  if (!workplace?.isActive) return error(res, 403, 'CLINIC_NOT_LINKED', 'La clínica no está vinculada activamente a tu perfil.');
  const service = await prisma.service.findFirst({
    where: { id: serviceId, doctorProfileId: doctor.id, isActive: true },
  });
  if (!service) return error(res, 404, 'SERVICE_NOT_AVAILABLE', 'El servicio no pertenece al médico o no está activo.');
  if (service.clinicProfileId && service.clinicProfileId !== clinicId) {
    return error(res, 403, 'SERVICE_NOT_COMPATIBLE', 'El servicio no está disponible en la clínica seleccionada.');
  }

  try {
    const appointment = await createAppointment({
      ...(patient.kind === 'registered' ? { patientUserId: patient.id } : {
        invitedPatient: {
          ...patient.patient,
          invitedByUserId: req.user!.id,
        },
      }),
      doctorId: doctor.id,
      clinicId,
      serviceId: service.id,
      requestedStart: startsAt,
      paymentMethod: 'NONE',
    });
    const recipient = appointment.patientRecipient;
    // Notification delivery is persisted transactionally by createAppointment.
    // sendEmail remains accepted for backwards compatibility; user preferences
    // will be evaluated by the worker when that preference model is introduced.
    void sendEmail;
    const { patientRecipient: _recipient, ...responseAppointment } = appointment;
    return res.status(201).json({ ...responseAppointment, patientLink: recipient?.invitationToken ? { status: 'PENDING', ...(canExposeDevelopmentToken() ? { developmentToken: recipient.invitationToken } : {}) } : { status: 'REGISTERED' } });
  } catch (caught) {
    if (caught instanceof BookingError) return error(res, caught.status, caught.code, caught.message);
    if (caught instanceof Error && caught.message === 'INVALID_START') {
      return error(res, 400, 'INVALID_START', 'La fecha y hora indicadas no son válidas.');
    }
    console.error('[Doctor appointment]', caught);
    return error(res, 500, 'INTERNAL_ERROR', 'No se pudo crear la cita.');
  }
}

/** Corrects an unclaimed invited-patient identity without creating a shadow user. */
export async function correctInvitedPatientEmail(req: AuthRequest, res: Response) {
  const doctor = await ownDoctor(req.user!.id);
  if (!doctor) return error(res, 404, 'DOCTOR_PROFILE_NOT_FOUND', 'No existe un perfil médico para esta sesión.');
  const parsedPatient = parseInvitedPatient(req.body?.patient);
  if (!parsedPatient.success) return error(res, 422, 'VALIDATION_ERROR', 'Revisa los datos del paciente.', parsedPatient.fields);
  const patient = parsedPatient.data;
  try {
    const result = await prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${doctor.id}))`;
      const appointment = await tx.appointment.findFirst({ where: { id: String(req.params.id), doctorProfileId: doctor.id }, include: { patientInvitation: true } });
      if (!appointment) throw new BookingError('APPOINTMENT_NOT_FOUND', 404, 'Cita no encontrada.');
      if (appointment.patientId) throw new BookingError('INVITED_PATIENT_ALREADY_CLAIMED', 409, 'La cita ya pertenece a un paciente registrado.');
      if (['CANCELLED', 'COMPLETED', 'MISSED'].includes(appointment.status)) throw new BookingError('INVITED_PATIENT_CORRECTION_NOT_ALLOWED', 422, 'La cita no permite corregir el paciente.');
      const resolution = await resolvePatientInvitation(tx, { email: patient.email, firstName: patient.firstName, lastName: patient.lastName, phone: typeof patient.phone === 'string' ? patient.phone : null, invitedByUserId: req.user!.id, doctorProfileId: doctor.id, clinicProfileId: appointment.clinicProfileId });
      if (appointment.patientInvitationId && appointment.patientInvitationId !== resolution.invitation?.id) {
        const remaining = await tx.appointment.count({ where: { patientInvitationId: appointment.patientInvitationId, patientId: null, id: { not: appointment.id } } });
        if (!remaining) await tx.patientInvitation.updateMany({ where: { id: appointment.patientInvitationId, status: 'PENDING' }, data: { status: 'REVOKED', revokedAt: new Date() } });
      }
      const updated = await tx.appointment.update({ where: { id: appointment.id }, data: { patientId: resolution.patient?.id ?? null, patientInvitationId: resolution.invitation?.id ?? null, invitedPatientFirstName: resolution.invitation?.firstName ?? null, invitedPatientLastName: resolution.invitation?.lastName ?? null, invitedPatientEmail: resolution.invitation?.email ?? null, invitedPatientPhone: resolution.invitation?.phone ?? null } });
      await tx.appointmentChangeLog.create({ data: { appointmentId: appointment.id, changedByUserId: req.user!.id, changeType: 'STATUS_CHANGED', previousStatus: appointment.status, newStatus: appointment.status, reason: 'INVITED_PATIENT_EMAIL_CORRECTED' } });
      if (resolution.invitationToken && resolution.invitation) await enqueueNotification(tx, { eventType: 'PATIENT_INVITED', aggregateId: appointment.id, deduplicationKey: `patient-invitation:${resolution.invitation.id}`, secret: { token: resolution.invitationToken } });
      return { appointment: updated, recipient: resolution.invitation ? { email: resolution.invitation.email, firstName: resolution.invitation.firstName, token: resolution.invitationToken, expiresAt: resolution.invitation.expiresAt } : null };
    });
    return res.json({ appointment: result.appointment, patientLink: result.recipient?.token ? { status: 'PENDING', ...(canExposeDevelopmentToken() ? { developmentToken: result.recipient.token } : {}) } : { status: 'REGISTERED' } });
  } catch (caught) {
    if (caught instanceof BookingError) return error(res, caught.status, caught.code, caught.message);
    console.error('[Correct invited patient]', caught);
    return error(res, 500, 'INTERNAL_ERROR', 'No se pudo corregir el paciente invitado.');
  }
}
