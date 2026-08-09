import bcrypt from 'bcrypt';
import request from 'supertest';
import app from '../../app';
import prisma, { disconnectPrisma } from '../../prisma';
import { generateToken } from '../../utils/jwt';
import { cancelAppointment, createAppointment, rescheduleAppointment } from '../../services/appointmentBooking.service';
import { enqueueNotification } from '../../services/notificationOutbox.service';
import { processNotificationOutboxBatch } from '../../services/notificationOutboxWorker.service';
import { notificationService } from '../../services/notification.service';
import { enqueueDueAppointmentReminders } from '../../jobs/appointment.jobs';
import { assertIntegrationDatabase, clearIntegrationDatabase } from './testDatabase';

describe('outbox transaccional de notificaciones', () => {
  let doctorUserId = ''; let doctorId = ''; let patientId = ''; let clinicId = ''; let workplaceId = ''; let serviceId = ''; let doctorToken = ''; let patientToken = '';
  beforeEach(async () => {
    assertIntegrationDatabase(); await clearIntegrationDatabase();
    process.env.NOTIFICATION_OUTBOX_MAX_ATTEMPTS = '3';
    const passwordHash = await bcrypt.hash('password-123456', 4);
    const doctorUser = await prisma.user.create({ data: { email: 'outbox.doctor@zenda.test', emailNormalized: 'outbox.doctor@zenda.test', firstName: 'Outbox', lastName: 'Doctor', passwordHash, role: 'DOCTOR' } });
    const patient = await prisma.user.create({ data: { email: 'outbox.patient@zenda.test', emailNormalized: 'outbox.patient@zenda.test', firstName: 'Outbox', lastName: 'Patient', passwordHash, role: 'PATIENT' } });
    const clinicUser = await prisma.user.create({ data: { email: 'outbox.clinic@zenda.test', emailNormalized: 'outbox.clinic@zenda.test', firstName: 'Outbox', lastName: 'Clinic', passwordHash, role: 'CLINIC_ADMIN' } });
    const doctor = await prisma.doctorProfile.create({ data: { userId: doctorUser.id, licenseNumber: 'OUTBOX-001', consultationPrice: 0, verificationStatus: 'APPROVED', isVerified: true } });
    const clinic = await prisma.clinicProfile.create({ data: { userId: clinicUser.id, name: 'Clínica Outbox', address: 'Quito', verificationStatus: 'APPROVED' } });
    const workplace = await prisma.doctorClinicWorkplace.create({ data: { doctorProfileId: doctor.id, clinicProfileId: clinic.id, isActive: true } });
    const service = await prisma.service.create({ data: { name: 'Consulta outbox', doctorProfileId: doctor.id, clinicProfileId: clinic.id, duration: 30, price: 20, priceCents: 2000, isActive: true } });
    await prisma.workSchedule.createMany({ data: [0, 1, 2, 3, 4].map(weekday => ({ workplaceId: workplace.id, weekday, timezone: 'America/Guayaquil', startTime: '08:00', endTime: '18:00' })) });
    doctorUserId = doctorUser.id; doctorId = doctor.id; patientId = patient.id; clinicId = clinic.id; workplaceId = workplace.id; serviceId = service.id;
    doctorToken = generateToken({ id: doctorUser.id, role: 'DOCTOR' }); patientToken = generateToken({ id: patient.id, role: 'PATIENT' });
    jest.spyOn(notificationService, 'sendEmail').mockResolvedValue(true); jest.spyOn(notificationService, 'sendPushNotification').mockResolvedValue(true);
  });
  afterEach(() => jest.restoreAllMocks());
  afterAll(async () => { await clearIntegrationDatabase(); await disconnectPrisma(); });

  async function registeredAppointment(startsAt = '2026-10-05T09:00:00-05:00') {
    return createAppointment({ patientUserId: patientId, doctorId, clinicId, serviceId, requestedStart: startsAt, paymentMethod: 'NONE' });
  }

  it('crea los eventos de cita en la misma transacción y no deja outbox huérfano al hacer rollback', async () => {
    const appointment = await registeredAppointment();
    expect(await prisma.notificationOutbox.count({ where: { aggregateId: appointment.id } })).toBe(2);
    await expect(prisma.$transaction(async tx => { await enqueueNotification(tx, { eventType: 'APPOINTMENT_REMINDER', aggregateId: appointment.id, deduplicationKey: 'rollback-test' }); throw new Error('ROLLBACK'); })).rejects.toThrow('ROLLBACK');
    expect(await prisma.notificationOutbox.count({ where: { deduplicationKey: 'rollback-test' } })).toBe(0);
  });

  it('cancelar y reprogramar crean eventos correctos sin exponer notas internas', async () => {
    const cancelled = await registeredAppointment();
    await cancelAppointment(cancelled.id, patientId, { internalNote: 'NOTA-INTERNA-SECRETA', patientMessage: 'Mensaje público' });
    const cancelEvent = await prisma.notificationOutbox.findUniqueOrThrow({ where: { deduplicationKey: `appointment:${cancelled.id}:cancelled` } });
    expect(JSON.stringify(cancelEvent.payload)).not.toContain('NOTA-INTERNA-SECRETA'); expect(JSON.stringify(cancelEvent.payload)).toContain('Mensaje público');
    const moved = await registeredAppointment('2026-10-06T09:00:00-05:00');
    await rescheduleAppointment(moved.id, patientId, '2026-10-06T10:00:00-05:00', { reason: 'Preferencia', patientMessage: 'Nueva hora' });
    expect(await prisma.notificationOutbox.findFirst({ where: { aggregateId: moved.id, eventType: 'APPOINTMENT_RESCHEDULED' } })).toMatchObject({ status: 'PENDING' });
  });

  it('worker crea notificación in-app, email y no duplica al reprocesar', async () => {
    const appointment = await registeredAppointment();
    await processNotificationOutboxBatch();
    expect(await prisma.userNotification.count({ where: { userId: patientId } })).toBe(2);
    expect(notificationService.sendEmail).toHaveBeenCalledTimes(1);
    await processNotificationOutboxBatch();
    expect(notificationService.sendEmail).toHaveBeenCalledTimes(1);
    expect(await prisma.notificationOutbox.count({ where: { aggregateId: appointment.id, status: 'SENT' } })).toBe(2);
  });

  it('reintenta fallos transitorios y dos workers no procesan el mismo evento', async () => {
    const appointment = await registeredAppointment(); await prisma.notificationOutbox.deleteMany();
    await prisma.$transaction(tx => enqueueNotification(tx, { eventType: 'APPOINTMENT_CANCELLED', aggregateId: appointment.id, deduplicationKey: 'retry-event' }));
    (notificationService.sendEmail as jest.Mock).mockResolvedValueOnce(false).mockResolvedValue(true);
    await processNotificationOutboxBatch();
    expect(await prisma.notificationOutbox.findUniqueOrThrow({ where: { deduplicationKey: 'retry-event' } })).toMatchObject({ status: 'PENDING', attempts: 1 });
    await prisma.notificationOutbox.update({ where: { deduplicationKey: 'retry-event' }, data: { availableAt: new Date(0) } });
    await Promise.all([processNotificationOutboxBatch(), processNotificationOutboxBatch()]);
    expect(await prisma.notificationOutbox.findUniqueOrThrow({ where: { deduplicationKey: 'retry-event' } })).toMatchObject({ status: 'SENT', attempts: 2 });
    expect(notificationService.sendEmail).toHaveBeenCalledTimes(2);
  });

  it('paciente invitado usa email cifrado y no intenta FCM', async () => {
    const appointment = await createAppointment({ invitedPatient: { email: 'invited.outbox@zenda.test', firstName: 'Invitada', lastName: 'Outbox', phone: null, invitedByUserId: doctorUserId }, doctorId, clinicId, serviceId, requestedStart: '2026-10-07T09:00:00-05:00', paymentMethod: 'NONE' });
    const invitation = await prisma.notificationOutbox.findFirstOrThrow({ where: { aggregateId: appointment.id, eventType: 'PATIENT_INVITED' } });
    expect(invitation.encryptedPayload).toBeTruthy(); expect(JSON.stringify(invitation.payload)).not.toContain(appointment.patientRecipient?.invitationToken);
    await processNotificationOutboxBatch();
    expect(notificationService.sendEmail).toHaveBeenCalledTimes(1); // invitation only
    expect(notificationService.sendPushNotification).not.toHaveBeenCalled();
  });

  it('endpoints solo permiten leer y marcar notificaciones propias', async () => {
    await registeredAppointment(); await processNotificationOutboxBatch();
    const listed = await request(app).get('/api/notifications').set('Authorization', `Bearer ${patientToken}`).expect(200);
    expect(listed.body.items).toHaveLength(2);
    await request(app).patch(`/api/notifications/${listed.body.items[0].id}/read`).set('Authorization', `Bearer ${doctorToken}`).expect(404);
    await request(app).patch(`/api/notifications/${listed.body.items[0].id}/read`).set('Authorization', `Bearer ${patientToken}`).expect(200);
    await request(app).patch('/api/notifications/read-all').set('Authorization', `Bearer ${patientToken}`).expect(200);
  });

  it('ruta heredada devuelve 410 y no cambia el estado', async () => {
    const appointment = await registeredAppointment();
    const response = await request(app).patch(`/api/bookings/${appointment.id}/status`).set('Authorization', `Bearer ${doctorToken}`).send({ status: 'COMPLETED' }).expect(410);
    expect(response.headers.deprecation).toBe('true');
    expect((await prisma.appointment.findUniqueOrThrow({ where: { id: appointment.id } })).status).toBe('CONFIRMED');
  });

  it('no encola recordatorio cancelado y usa la fecha reprogramada sin duplicar', async () => {
    const cancelled = await registeredAppointment('2026-10-08T09:00:00-05:00');
    await cancelAppointment(cancelled.id, patientId);
    expect(await enqueueDueAppointmentReminders(new Date('2026-10-07T14:00:00.000Z'))).toBe(0);
    const moved = await registeredAppointment('2026-10-09T09:00:00-05:00');
    await rescheduleAppointment(moved.id, patientId, '2026-10-09T10:00:00-05:00');
    const now = new Date('2026-10-08T15:00:00.000Z');
    expect(await enqueueDueAppointmentReminders(now)).toBe(1);
    expect(await enqueueDueAppointmentReminders(now)).toBe(0);
    expect(await prisma.notificationOutbox.count({ where: { aggregateId: moved.id, eventType: 'APPOINTMENT_REMINDER' } })).toBe(1);
  });
});
