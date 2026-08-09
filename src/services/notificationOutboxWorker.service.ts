import crypto from 'crypto';
import { Prisma } from '../../generated/prisma';
import prisma from '../prisma';
import { notificationService } from './notification.service';
import { decryptOutboxSecret, sanitizeOutboxError } from './notificationOutbox.service';
import { appointmentCancelledTemplate, appointmentCreatedTemplate, appointmentReminderTemplate, appointmentRescheduledTemplate, patientInvitationTemplate, type NotificationTemplate } from './notificationTemplates.service';

type ClaimedEvent = { id: string; eventType: string; aggregateId: string; payload: Prisma.JsonValue; encryptedPayload: string | null; attempts: number; lockToken: string };
const batchSize = () => Math.max(1, Math.min(200, Number(process.env.NOTIFICATION_OUTBOX_BATCH_SIZE ?? 50) || 50));
const maxAttempts = () => Math.max(1, Number(process.env.NOTIFICATION_OUTBOX_MAX_ATTEMPTS ?? 5) || 5);
const backoffMs = (attempt: number) => Math.min(60 * 60_000, 30_000 * 2 ** Math.max(0, attempt - 1));

async function claimBatch(): Promise<ClaimedEvent[]> {
  const token = crypto.randomUUID(); const staleBefore = new Date(Date.now() - 5 * 60_000);
  return prisma.$queryRaw<ClaimedEvent[]>`
    UPDATE "NotificationOutbox" o
    SET "status" = 'PROCESSING'::"NotificationOutboxStatus",
        "attempts" = o."attempts" + 1,
        "lockedAt" = NOW(), "lockToken" = ${token}, "updatedAt" = NOW()
    FROM (
      SELECT id FROM "NotificationOutbox"
      WHERE (("status" = 'PENDING' AND "availableAt" <= NOW())
          OR ("status" = 'PROCESSING' AND "lockedAt" < ${staleBefore}))
      ORDER BY "availableAt", "createdAt"
      FOR UPDATE SKIP LOCKED
      LIMIT ${batchSize()}
    ) picked
    WHERE o.id = picked.id
    RETURNING o.id, o."eventType", o."aggregateId", o.payload,
              o."encryptedPayload", o.attempts, o."lockToken"
  `;
}

function record(payload: Prisma.JsonValue): Record<string, unknown> { return payload && typeof payload === 'object' && !Array.isArray(payload) ? payload as Record<string, unknown> : {}; }
async function channelOnce(outboxId: string, channel: string, send: () => Promise<boolean>): Promise<void> {
  const existing = await prisma.notificationDelivery.findUnique({ where: { outboxId_channel: { outboxId, channel } } });
  if (existing?.status === 'SENT') return;
  await prisma.notificationDelivery.upsert({ where: { outboxId_channel: { outboxId, channel } }, create: { outboxId, channel, status: 'PROCESSING' }, update: { status: 'PROCESSING' } });
  if (!await send()) throw new Error(`${channel}_DELIVERY_FAILED`);
  await prisma.notificationDelivery.update({ where: { outboxId_channel: { outboxId, channel } }, data: { status: 'SENT', processedAt: new Date() } });
  console.info(JSON.stringify({ event: 'notification_channel_sent', outboxId, channel }));
}

async function processEvent(event: ClaimedEvent): Promise<void> {
  const appointment = await prisma.appointment.findUnique({ where: { id: event.aggregateId }, include: { patient: true, patientInvitation: true, doctorProfile: { include: { user: true } }, clinicProfile: true } });
  if (!appointment) return;
  if (event.eventType === 'APPOINTMENT_REMINDER' && appointment.status === 'CANCELLED') return;
  const patient = appointment.patient; const invited = appointment.patientInvitation;
  if (!patient && !invited) return;
  const payload = record(event.payload);
  const input = { patientFirstName: patient?.firstName ?? invited!.firstName, doctorName: `${appointment.doctorProfile.user.firstName} ${appointment.doctorProfile.user.lastName}`.trim(), clinicName: appointment.clinicProfile.name, startsAt: appointment.startsAt ?? appointment.startDatetime ?? appointment.date, previousStartsAt: typeof payload.previousStartsAt === 'string' ? new Date(payload.previousStartsAt) : undefined, patientMessage: typeof payload.patientMessage === 'string' ? payload.patientMessage : null };
  let template: NotificationTemplate;
  if (event.eventType === 'APPOINTMENT_CANCELLED') template = appointmentCancelledTemplate(input);
  else if (event.eventType === 'APPOINTMENT_RESCHEDULED') template = appointmentRescheduledTemplate(input);
  else if (event.eventType === 'APPOINTMENT_REMINDER' || event.eventType === 'APPOINTMENT_CONFIRMATION_REQUIRED') template = appointmentReminderTemplate(input);
  else if (event.eventType === 'PATIENT_INVITED') {
    if (!event.encryptedPayload || !invited) throw new Error('MISSING_INVITATION_SECRET');
    const token = decryptOutboxSecret(event.encryptedPayload).token;
    if (!token) throw new Error('MISSING_INVITATION_TOKEN');
    const url = `${process.env.PATIENT_INVITATION_REGISTER_URL || 'http://localhost:5173/register'}?invitation=${encodeURIComponent(token)}`;
    template = patientInvitationTemplate(input, url);
  } else template = appointmentCreatedTemplate(input);

  if (patient) {
    await prisma.userNotification.upsert({ where: { userId_outboxId: { userId: patient.id, outboxId: event.id } }, create: { userId: patient.id, outboxId: event.id, type: event.eventType, title: template.title, message: template.message, data: { appointmentId: appointment.id } }, update: {} });
  }
  if (['APPOINTMENT_CREATED', 'APPOINTMENT_CANCELLED', 'APPOINTMENT_RESCHEDULED'].includes(event.eventType)) {
    const patientName = patient ? `${patient.firstName} ${patient.lastName}`.trim() : `${invited?.firstName ?? ''} ${invited?.lastName ?? ''}`.trim() || 'Paciente invitado';
    const eventLabel = event.eventType === 'APPOINTMENT_CREATED' ? 'Nueva cita' : event.eventType === 'APPOINTMENT_CANCELLED' ? 'Cita cancelada' : 'Cita reprogramada';
    const doctorMessage = `${patientName} · ${appointment.clinicProfile.name} · ${new Intl.DateTimeFormat('es-EC', { timeZone: 'America/Guayaquil', dateStyle: 'medium', timeStyle: 'short' }).format(appointment.startsAt ?? appointment.startDatetime ?? appointment.date)}`;
    await prisma.userNotification.upsert({ where: { userId_outboxId: { userId: appointment.doctorProfile.userId, outboxId: event.id } }, create: { userId: appointment.doctorProfile.userId, outboxId: event.id, type: event.eventType, title: eventLabel, message: doctorMessage, data: { appointmentId: appointment.id } }, update: {} });
  }
  const email = patient?.email ?? invited?.email;
  const shouldEmail = event.eventType !== 'APPOINTMENT_CONFIRMATION_REQUIRED' && !(event.eventType === 'APPOINTMENT_CREATED' && !patient);
  if (email && shouldEmail) await channelOnce(event.id, 'EMAIL', () => notificationService.sendEmail(email, template.title, template.html, event.id));
  if (patient?.fcmToken && event.eventType !== 'APPOINTMENT_CONFIRMATION_REQUIRED') await channelOnce(event.id, 'FCM', () => notificationService.sendPushNotification(patient.fcmToken!, template.title, template.message));
}

export async function processNotificationOutboxBatch(): Promise<number> {
  const events = await claimBatch();
  for (const event of events) {
    try {
      await processEvent(event);
      await prisma.notificationOutbox.updateMany({ where: { id: event.id, lockToken: event.lockToken, status: 'PROCESSING' }, data: { status: 'SENT', processedAt: new Date(), lockedAt: null, lockToken: null, lastError: null } });
      console.info(JSON.stringify({ event: 'notification_outbox_sent', outboxId: event.id, eventType: event.eventType }));
    } catch (error) {
      const terminal = event.attempts >= maxAttempts();
      await prisma.notificationOutbox.updateMany({ where: { id: event.id, lockToken: event.lockToken }, data: { status: terminal ? 'FAILED' : 'PENDING', availableAt: terminal ? new Date() : new Date(Date.now() + backoffMs(event.attempts)), lockedAt: null, lockToken: null, lastError: sanitizeOutboxError(error) } });
      console.warn(JSON.stringify({ event: terminal ? 'notification_outbox_failed' : 'notification_outbox_retry', outboxId: event.id, eventType: event.eventType, attempt: event.attempts }));
    }
  }
  return events.length;
}
