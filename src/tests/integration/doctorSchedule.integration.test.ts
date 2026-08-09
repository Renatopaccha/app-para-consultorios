import bcrypt from 'bcrypt';
import request from 'supertest';
import app from '../../app';
import prisma, { disconnectPrisma } from '../../prisma';
import { generateToken } from '../../utils/jwt';
import { assertIntegrationDatabase, clearIntegrationDatabase } from './testDatabase';

describe('agenda canónica del doctor con PostgreSQL real', () => {
  let doctorUserId = '';
  let doctorId = '';
  let doctorToken = '';
  let patientId = '';
  let patientToken = '';
  let clinicId = '';
  let otherClinicId = '';
  let workplaceId = '';
  let serviceId = '';

  beforeEach(async () => {
    assertIntegrationDatabase();
    await clearIntegrationDatabase();
    const passwordHash = await bcrypt.hash('password-123456', 4);
    const [doctorUser, patientUser, clinicUser, otherClinicUser] = await Promise.all([
      prisma.user.create({ data: { email: 'schedule.doctor@zenda.test', emailNormalized: 'schedule.doctor@zenda.test', firstName: 'Agenda', lastName: 'Doctor', passwordHash, role: 'DOCTOR' } }),
      prisma.user.create({ data: { email: 'schedule.patient@zenda.test', emailNormalized: 'schedule.patient@zenda.test', firstName: 'Agenda', lastName: 'Paciente', passwordHash, role: 'PATIENT' } }),
      prisma.user.create({ data: { email: 'schedule.clinic@zenda.test', emailNormalized: 'schedule.clinic@zenda.test', firstName: 'Agenda', lastName: 'Clínica', passwordHash, role: 'CLINIC_ADMIN' } }),
      prisma.user.create({ data: { email: 'schedule.other-clinic@zenda.test', emailNormalized: 'schedule.other-clinic@zenda.test', firstName: 'Otra', lastName: 'Clínica', passwordHash, role: 'CLINIC_ADMIN' } }),
    ]);
    const doctor = await prisma.doctorProfile.create({
      data: { userId: doctorUser.id, licenseNumber: 'SCHEDULE-001', consultationPrice: 0, verificationStatus: 'APPROVED', isVerified: true },
    });
    const clinic = await prisma.clinicProfile.create({
      data: { userId: clinicUser.id, name: 'Clínica Agenda', address: 'Quito', verificationStatus: 'APPROVED' },
    });
    const otherClinic = await prisma.clinicProfile.create({
      data: { userId: otherClinicUser.id, name: 'Clínica Ajena', address: 'Guayaquil', verificationStatus: 'APPROVED' },
    });
    const workplace = await prisma.doctorClinicWorkplace.create({
      data: { doctorProfileId: doctor.id, clinicProfileId: clinic.id, isActive: true },
    });
    const service = await prisma.service.create({
      data: { name: 'Consulta agenda', doctorProfileId: doctor.id, clinicProfileId: clinic.id, duration: 45, price: 35, priceCents: 3500, isActive: true },
    });
    doctorUserId = doctorUser.id;
    doctorId = doctor.id;
    doctorToken = generateToken({ id: doctorUser.id, role: 'DOCTOR' });
    patientId = patientUser.id;
    patientToken = generateToken({ id: patientUser.id, role: 'PATIENT' });
    clinicId = clinic.id;
    otherClinicId = otherClinic.id;
    workplaceId = workplace.id;
    serviceId = service.id;
  });

  afterAll(async () => {
    await clearIntegrationDatabase();
    await disconnectPrisma();
  });

  it('guarda varios turnos, habilita sábado y reemplaza el conjunto completo en una transacción', async () => {
    const first = await request(app)
      .put('/api/doctors/me/work-schedules')
      .set('Authorization', `Bearer ${doctorToken}`)
      .send({
        clinicId,
        schedules: [
          { weekday: 0, startTime: '08:00', endTime: '12:00' },
          { weekday: 0, startTime: '13:00', endTime: '17:00' },
          { weekday: 5, startTime: '09:00', endTime: '13:00' },
        ],
      })
      .expect(200);
    expect(first.body.items).toHaveLength(3);
    expect(first.body.items).toEqual(expect.arrayContaining([
      expect.objectContaining({ weekday: 5, startTime: '09:00', endTime: '13:00', timezone: 'America/Guayaquil' }),
    ]));

    const second = await request(app)
      .put('/api/doctors/me/work-schedules')
      .set('Authorization', `Bearer ${doctorToken}`)
      .send({ clinicId, schedules: [{ weekday: 5, startTime: '10:00', endTime: '14:00' }] })
      .expect(200);
    expect(second.body.items).toHaveLength(1);
    expect(await prisma.workSchedule.findMany({ where: { workplaceId } })).toEqual([
      expect.objectContaining({ weekday: 5, startTime: '10:00', endTime: '14:00' }),
    ]);

    const loaded = await request(app)
      .get('/api/doctors/me/work-schedules')
      .query({ clinicId })
      .set('Authorization', `Bearer ${doctorToken}`)
      .expect(200);
    expect(loaded.body.items).toEqual([
      expect.objectContaining({ weekday: 5, startTime: '10:00', endTime: '14:00' }),
    ]);
  });

  it('rechaza rol incorrecto, clínica ajena, intervalos invertidos y solapamientos sin guardar parcialmente', async () => {
    const payload = { clinicId, schedules: [{ weekday: 0, startTime: '09:00', endTime: '12:00' }] };
    await request(app)
      .put('/api/doctors/me/work-schedules')
      .set('Authorization', `Bearer ${patientToken}`)
      .send(payload)
      .expect(403);
    await request(app)
      .put('/api/doctors/me/work-schedules')
      .set('Authorization', `Bearer ${doctorToken}`)
      .send({ ...payload, clinicId: otherClinicId })
      .expect(403);
    await request(app)
      .put('/api/doctors/me/work-schedules')
      .set('Authorization', `Bearer ${doctorToken}`)
      .send({ clinicId, schedules: [{ weekday: 0, startTime: '12:00', endTime: '09:00' }] })
      .expect(400);
    await request(app)
      .put('/api/doctors/me/work-schedules')
      .set('Authorization', `Bearer ${doctorToken}`)
      .send({
        clinicId,
        schedules: [
          { weekday: 0, startTime: '09:00', endTime: '12:00' },
          { weekday: 0, startTime: '11:00', endTime: '13:00' },
        ],
      })
      .expect(400);
    expect(await prisma.workSchedule.count({ where: { workplaceId } })).toBe(0);
  });

  it('crea bloqueo personal, lo consulta por semana y persiste exactamente en UTC', async () => {
    const created = await request(app)
      .post('/api/schedule-blocks')
      .set('Authorization', `Bearer ${doctorToken}`)
      .send({
        clinicId,
        startsAt: '2026-10-05T10:00:00-05:00',
        endsAt: '2026-10-05T11:30:00-05:00',
        type: 'PERSONAL',
        reason: 'Asunto personal',
      })
      .expect(201);
    expect(created.body).toMatchObject({ doctorProfileId: doctorId, clinicProfileId: clinicId, type: 'PERSONAL' });
    expect(created.body.startsAt).toBe('2026-10-05T15:00:00.000Z');

    const loaded = await request(app)
      .get('/api/schedule-blocks')
      .query({ rangeStart: '2026-10-05T00:00:00-05:00', rangeEnd: '2026-10-12T00:00:00-05:00', clinicId })
      .set('Authorization', `Bearer ${doctorToken}`)
      .expect(200);
    expect(loaded.body.items).toEqual([
      expect.objectContaining({ id: created.body.id, type: 'PERSONAL', reason: 'Asunto personal' }),
    ]);
    expect(await prisma.scheduleBlock.findUnique({ where: { id: created.body.id } })).toMatchObject({
      startsAt: new Date('2026-10-05T15:00:00.000Z'),
      endsAt: new Date('2026-10-05T16:30:00.000Z'),
      type: 'PERSONAL',
    });
  });

  it('rechaza bloqueos inválidos o en una clínica no vinculada', async () => {
    await request(app)
      .post('/api/schedule-blocks')
      .set('Authorization', `Bearer ${doctorToken}`)
      .send({ clinicId, startsAt: '2026-10-05T11:00:00-05:00', endsAt: '2026-10-05T10:00:00-05:00', type: 'BLOCK' })
      .expect(400);
    await request(app)
      .post('/api/schedule-blocks')
      .set('Authorization', `Bearer ${doctorToken}`)
      .send({ clinicId: otherClinicId, startsAt: '2026-10-05T10:00:00-05:00', endsAt: '2026-10-05T11:00:00-05:00', type: 'BLOCK' })
      .expect(403);
  });

  it('edita y desbloquea un bloqueo del médico con auditoría, sin revelar detalles al paciente', async () => {
    const created = await request(app).post('/api/schedule-blocks').set('Authorization', `Bearer ${doctorToken}`).send({
      clinicId, startsAt: '2026-10-05T10:00:00-05:00', endsAt: '2026-10-05T11:00:00-05:00', type: 'BLOCK', visibility: 'PUBLIC_LABEL', publicLabel: 'LUNCH', privateTitle: 'Almuerzo privado', internalNotes: 'No divulgar',
    }).expect(201);
    expect(created.body).toMatchObject({ visibility: 'PUBLIC_LABEL', publicLabel: 'LUNCH', privateTitle: 'Almuerzo privado' });
    await request(app).get('/api/schedule-blocks').query({ doctorId, clinicId }).set('Authorization', `Bearer ${patientToken}`).expect(403);
    const edited = await request(app).patch(`/api/schedule-blocks/${created.body.id}`).set('Authorization', `Bearer ${doctorToken}`).send({
      endsAt: '2026-10-05T11:30:00-05:00', privateTitle: 'Pausa de mediodía', expectedUpdatedAt: created.body.updatedAt,
    }).expect(200);
    expect(edited.body).toMatchObject({ privateTitle: 'Pausa de mediodía' });
    await request(app).delete(`/api/schedule-blocks/${created.body.id}`).set('Authorization', `Bearer ${doctorToken}`).expect(200);
    expect(await prisma.scheduleBlock.findUnique({ where: { id: created.body.id } })).toMatchObject({ deletedByUserId: doctorUserId });
    expect(await prisma.scheduleBlockChangeLog.count({ where: { scheduleBlockId: created.body.id } })).toBe(3);
  });

  it('crea cita manual con paciente existente, duración y snapshots del servicio', async () => {
    await prisma.workSchedule.create({
      data: { workplaceId, weekday: 0, timezone: 'America/Guayaquil', startTime: '08:00', endTime: '18:00' },
    });
    const created = await request(app)
      .post('/api/doctors/me/appointments')
      .set('Authorization', `Bearer ${doctorToken}`)
      .send({ patientId, clinicId, serviceId, startsAt: '2026-10-05T09:00:00-05:00', sendEmail: false })
      .expect(201);
    expect(created.body).toMatchObject({
      patientId,
      doctorProfileId: doctorId,
      clinicProfileId: clinicId,
      serviceId,
      startTime: '09:00',
      endTime: '09:45',
      serviceNameSnapshot: 'Consulta agenda',
      serviceDurationMinutesSnapshot: 45,
      servicePriceCentsSnapshot: 3500,
    });
  });

  it('rechaza paciente inexistente, servicio ajeno, clínica ajena, fuera de jornada y sobre bloqueo', async () => {
    await prisma.workSchedule.create({
      data: { workplaceId, weekday: 0, timezone: 'America/Guayaquil', startTime: '08:00', endTime: '12:00' },
    });
    const base = { patientId, clinicId, serviceId, startsAt: '2026-10-05T09:00:00-05:00', sendEmail: false };
    await request(app).post('/api/doctors/me/appointments').set('Authorization', `Bearer ${doctorToken}`)
      .send({ ...base, patientId: '00000000-0000-0000-0000-000000000000' }).expect(404);
    const otherDoctorUser = await prisma.user.create({
      data: { email: 'schedule.other-doctor@zenda.test', emailNormalized: 'schedule.other-doctor@zenda.test', firstName: 'Otro', lastName: 'Doctor', passwordHash: 'x', role: 'DOCTOR' },
    });
    const otherDoctor = await prisma.doctorProfile.create({
      data: { userId: otherDoctorUser.id, licenseNumber: 'SCHEDULE-002', consultationPrice: 0, verificationStatus: 'APPROVED', isVerified: true },
    });
    const otherService = await prisma.service.create({
      data: { name: 'Servicio ajeno', doctorProfileId: otherDoctor.id, duration: 30, price: 10, priceCents: 1000 },
    });
    await request(app).post('/api/doctors/me/appointments').set('Authorization', `Bearer ${doctorToken}`)
      .send({ ...base, serviceId: otherService.id }).expect(404);
    await request(app).post('/api/doctors/me/appointments').set('Authorization', `Bearer ${doctorToken}`)
      .send({ ...base, clinicId: otherClinicId }).expect(403);
    await request(app).post('/api/doctors/me/appointments').set('Authorization', `Bearer ${doctorToken}`)
      .send({ ...base, startsAt: '2026-10-05T13:00:00-05:00' }).expect(422);
    await prisma.scheduleBlock.create({
      data: {
        doctorProfileId: doctorId,
        clinicProfileId: clinicId,
        startsAt: new Date('2026-10-05T14:00:00.000Z'),
        endsAt: new Date('2026-10-05T15:00:00.000Z'),
        type: 'BLOCK',
        createdByUserId: doctorUserId,
      },
    });
    const conflict = await request(app).post('/api/doctors/me/appointments').set('Authorization', `Bearer ${doctorToken}`)
      .send(base).expect(409);
    expect(conflict.body).toMatchObject({ error: 'APPOINTMENT_TIME_CONFLICT' });
  });

  it('reutiliza inmediatamente el intervalo de un bloqueo desbloqueado y conserva su historial', async () => {
    await prisma.workSchedule.create({ data: { workplaceId, weekday: 0, timezone: 'America/Guayaquil', startTime: '08:00', endTime: '18:00' } });
    const payload = { clinicId, startsAt: '2026-10-05T09:00:00-05:00', endsAt: '2026-10-05T10:00:00-05:00', type: 'BLOCK' };
    const first = await request(app).post('/api/schedule-blocks').set('Authorization', `Bearer ${doctorToken}`).send(payload).expect(201);
    const occupied = await request(app).get('/api/bookings/availability').query({ doctorId, clinicId, serviceId, date: '2026-10-05' }).expect(200);
    expect(occupied.body.slots).not.toContainEqual(expect.objectContaining({ startsAt: '2026-10-05T14:00:00.000Z' }));
    await request(app).delete(`/api/schedule-blocks/${first.body.id}`).set('Authorization', `Bearer ${doctorToken}`).expect(200);
    const available = await request(app).get('/api/bookings/availability').query({ doctorId, clinicId, serviceId, date: '2026-10-05' }).expect(200);
    expect(available.body.slots).toContainEqual(expect.objectContaining({ startsAt: '2026-10-05T14:00:00.000Z' }));
    const second = await request(app).post('/api/schedule-blocks').set('Authorization', `Bearer ${doctorToken}`).send(payload).expect(201);
    expect(await prisma.scheduleBlock.count({ where: { doctorProfileId: doctorId, startsAt: new Date('2026-10-05T14:00:00.000Z'), deletedAt: null } })).toBe(1);
    expect(await prisma.scheduleBlock.findUnique({ where: { id: first.body.id } })).toMatchObject({ deletedByUserId: doctorUserId });
    expect(await prisma.scheduleBlockChangeLog.count({ where: { scheduleBlockId: first.body.id } })).toBe(2);
    expect(await prisma.scheduleBlockChangeLog.count({ where: { scheduleBlockId: second.body.id } })).toBe(1);
    const repeated = await request(app).delete(`/api/schedule-blocks/${first.body.id}`).set('Authorization', `Bearer ${doctorToken}`).expect(409);
    expect(repeated.body).toMatchObject({ error: 'SCHEDULE_BLOCK_ALREADY_UNBLOCKED' });
  });

  it('reutiliza el intervalo de un evento personal desbloqueado', async () => {
    const payload = { clinicId, startsAt: '2026-10-05T14:00:00-05:00', endsAt: '2026-10-05T15:00:00-05:00', type: 'PERSONAL', privateTitle: 'Privado' };
    const first = await request(app).post('/api/schedule-blocks').set('Authorization', `Bearer ${doctorToken}`).send(payload).expect(201);
    await request(app).delete(`/api/schedule-blocks/${first.body.id}`).set('Authorization', `Bearer ${doctorToken}`).expect(200);
    await request(app).post('/api/schedule-blocks').set('Authorization', `Bearer ${doctorToken}`).send(payload).expect(201);
    expect(await prisma.scheduleBlock.count({ where: { doctorProfileId: doctorId, startsAt: new Date('2026-10-05T19:00:00.000Z'), deletedAt: null } })).toBe(1);
  });

  it('permite crear una cita después de desbloquear y un bloqueo después de cancelar', async () => {
    await prisma.workSchedule.create({ data: { workplaceId, weekday: 0, timezone: 'America/Guayaquil', startTime: '08:00', endTime: '18:00' } });
    const interval = { clinicId, startsAt: '2026-10-05T11:00:00-05:00', endsAt: '2026-10-05T12:00:00-05:00', type: 'BLOCK' };
    const blocked = await request(app).post('/api/schedule-blocks').set('Authorization', `Bearer ${doctorToken}`).send(interval).expect(201);
    await request(app).delete(`/api/schedule-blocks/${blocked.body.id}`).set('Authorization', `Bearer ${doctorToken}`).expect(200);
    const appointment = await request(app).post('/api/doctors/me/appointments').set('Authorization', `Bearer ${doctorToken}`).send({ patientId, clinicId, serviceId, startsAt: interval.startsAt, sendEmail: false }).expect(201);
    await request(app).patch(`/api/bookings/${appointment.body.id}/cancel`).set('Authorization', `Bearer ${doctorToken}`).send({ reasonCode: 'DOCTOR_UNAVAILABLE' }).expect(200);
    await request(app).post('/api/schedule-blocks').set('Authorization', `Bearer ${doctorToken}`).send(interval).expect(201);
  });

  it('mantiene la exclusión SQL para activos y devuelve conflicto estructurado', async () => {
    const payload = { clinicId, startsAt: '2026-10-05T10:00:00-05:00', endsAt: '2026-10-05T11:00:00-05:00', type: 'BLOCK' };
    const first = await request(app).post('/api/schedule-blocks').set('Authorization', `Bearer ${doctorToken}`).send(payload).expect(201);
    const conflict = await request(app).post('/api/schedule-blocks').set('Authorization', `Bearer ${doctorToken}`).send({ ...payload, startsAt: '2026-10-05T10:30:00-05:00' }).expect(409);
    expect(conflict.body).toEqual({ success: false, error: { code: 'SCHEDULE_CONFLICT', message: 'El intervalo se superpone con otro elemento activo', conflictType: 'SCHEDULE_BLOCK' } });
    expect(await prisma.scheduleBlock.count({ where: { deletedAt: null } })).toBe(1);
    await expect(prisma.scheduleBlock.create({ data: { doctorProfileId: doctorId, clinicProfileId: clinicId, startsAt: new Date('2026-10-05T15:30:00.000Z'), endsAt: new Date('2026-10-05T16:30:00.000Z'), type: 'BLOCK', createdByUserId: doctorUserId } })).rejects.toBeDefined();
    await request(app).delete(`/api/schedule-blocks/${first.body.id}`).set('Authorization', `Bearer ${doctorToken}`).expect(200);
    await expect(prisma.scheduleBlock.create({ data: { doctorProfileId: doctorId, clinicProfileId: clinicId, startsAt: new Date('2026-10-05T15:00:00.000Z'), endsAt: new Date('2026-10-05T16:00:00.000Z'), type: 'BLOCK', createdByUserId: doctorUserId } })).resolves.toBeDefined();
  });

  it('dos solicitudes manuales simultáneas producen una sola cita', async () => {
    await prisma.workSchedule.create({
      data: { workplaceId, weekday: 0, timezone: 'America/Guayaquil', startTime: '08:00', endTime: '18:00' },
    });
    const body = { patientId, clinicId, serviceId, startsAt: '2026-10-05T11:00:00-05:00', sendEmail: false };
    const responses = await Promise.all([
      request(app).post('/api/doctors/me/appointments').set('Authorization', `Bearer ${doctorToken}`).send(body),
      request(app).post('/api/doctors/me/appointments').set('Authorization', `Bearer ${doctorToken}`).send(body),
    ]);
    expect(responses.map((response) => response.status).sort()).toEqual([201, 409]);
    expect(await prisma.appointment.count({
      where: { doctorProfileId: doctorId, startsAt: new Date('2026-10-05T16:00:00.000Z') },
    })).toBe(1);
  });
});
