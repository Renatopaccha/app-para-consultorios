import bcrypt from 'bcrypt';
import request from 'supertest';
import app from '../../app';
import prisma, { disconnectPrisma } from '../../prisma';
import { generateToken } from '../../utils/jwt';
import { clearIntegrationDatabase, assertIntegrationDatabase } from './testDatabase';
import { setEmailVerificationAdapterForTests } from '../../services/email.service';

describe('citas manuales con paciente invitado y PostgreSQL real', () => {
  let doctorToken = ''; let clinicId = ''; let serviceId = '';
  const verificationTokens: string[] = [];

  beforeEach(async () => {
    assertIntegrationDatabase(); await clearIntegrationDatabase(); verificationTokens.length = 0;
    setEmailVerificationAdapterForTests(async email => { verificationTokens.push(email.token); });
    const hash = await bcrypt.hash('password-123456', 4);
    const [doctorUser, clinicUser] = await Promise.all([
      prisma.user.create({ data: { email: 'invite.doctor@zenda.test', emailNormalized: 'invite.doctor@zenda.test', firstName: 'Ana', lastName: 'Médica', passwordHash: hash, role: 'DOCTOR' } }),
      prisma.user.create({ data: { email: 'invite.clinic@zenda.test', emailNormalized: 'invite.clinic@zenda.test', firstName: 'Clínica', lastName: 'Prueba', passwordHash: hash, role: 'CLINIC_ADMIN' } }),
    ]);
    const doctor = await prisma.doctorProfile.create({ data: { userId: doctorUser.id, licenseNumber: 'PATIENT-INV-001', consultationPrice: 0, verificationStatus: 'APPROVED', isVerified: true } });
    const clinic = await prisma.clinicProfile.create({ data: { userId: clinicUser.id, name: 'Clínica Invitaciones', address: 'Quito', verificationStatus: 'APPROVED' } });
    const workplace = await prisma.doctorClinicWorkplace.create({ data: { doctorProfileId: doctor.id, clinicProfileId: clinic.id, isActive: true } });
    await prisma.workSchedule.create({ data: { workplaceId: workplace.id, weekday: 0, startTime: '08:00', endTime: '12:00' } });
    const service = await prisma.service.create({ data: { name: 'Consulta invitada', doctorProfileId: doctor.id, clinicProfileId: clinic.id, duration: 30, price: 25, priceCents: 2500, isActive: true } });
    doctorToken = generateToken({ id: doctorUser.id, role: 'DOCTOR' }); clinicId = clinic.id; serviceId = service.id;
  });

  afterAll(async () => { setEmailVerificationAdapterForTests(undefined); await clearIntegrationDatabase(); await disconnectPrisma(); });

  it('no crea un usuario fantasma, invita, verifica y reclama exactamente una vez', async () => {
    const created = await request(app).post('/api/doctors/me/appointments').set('Authorization', `Bearer ${doctorToken}`).send({
      clinicId, serviceId, startsAt: '2026-10-05T09:00:00-05:00', sendEmail: true,
      patient: { firstName: 'María', lastName: 'Invitada', email: '  MARIA.INVITADA@zenda.test ', phone: '0990000000' },
    }).expect(201);
    expect(created.body.patientId).toBeNull();
    expect(created.body.patientInvitationId).toBeTruthy();
    expect(created.body.patientLink.developmentToken).toBeTruthy();
    expect(await prisma.user.count({ where: { emailNormalized: 'maria.invitada@zenda.test' } })).toBe(0);
    const invitation = await prisma.patientInvitation.findUniqueOrThrow({ where: { id: created.body.patientInvitationId } });
    expect(invitation.tokenHash).not.toBe(created.body.patientLink.developmentToken);
    const outbox = await prisma.notificationOutbox.findFirstOrThrow({ where: { aggregateId: created.body.id, eventType: 'PATIENT_INVITED' } });
    expect(outbox.encryptedPayload).toBeTruthy();
    expect(JSON.stringify(outbox.payload)).not.toContain(created.body.patientLink.developmentToken);

    const registration = await request(app).post('/api/auth/register').send({ email: 'MARIA.INVITADA@zenda.test', password: 'password-123456', firstName: 'María', lastName: 'Invitada' }).expect(201);
    await request(app).post('/api/auth/login').send({ email: 'maria.invitada@zenda.test', password: 'password-123456' }).expect(200);
    await request(app).post('/api/auth/login').send({ email: '  MARIA.INVITADA@ZENDA.TEST  ', password: 'password-123456' }).expect(200);
    await request(app).post('/api/auth/login').send({ email: 'maria.invitada@zenda.test', password: 'PASSWORD-123456' }).expect(401);
    expect(verificationTokens).toHaveLength(1);
    await request(app).post('/api/auth/verify-email').send({ token: verificationTokens[0] }).expect(200).expect(({ body }) => expect(body.claimedAppointments).toBe(1));
    const appointment = await prisma.appointment.findUniqueOrThrow({ where: { id: created.body.id } });
    expect(appointment.patientId).toBe(registration.body.user.id);
    expect(appointment.patientInvitationId).toBe(invitation.id);
    expect((await prisma.patientInvitation.findUniqueOrThrow({ where: { id: invitation.id } })).status).toBe('ACCEPTED');
    await request(app).get('/api/patients/my-appointments').set('Authorization', `Bearer ${registration.body.token}`).expect(200).expect(({ body }) => expect(body).toHaveLength(1));
    await request(app).post('/api/auth/verify-email').send({ token: verificationTokens[0] }).expect(410);
  });

  it('no expone el token de invitación si el entorno es production', async () => {
    const previous = process.env.NODE_ENV; const previousKey = process.env.NOTIFICATION_OUTBOX_ENCRYPTION_KEY; process.env.NODE_ENV = 'production'; process.env.NOTIFICATION_OUTBOX_ENCRYPTION_KEY = 'integration-only-not-a-production-secret';
    try {
      const response = await request(app).post('/api/doctors/me/appointments').set('Authorization', `Bearer ${doctorToken}`).send({ clinicId, serviceId, startsAt: '2026-10-05T09:00:00-05:00', patient: { firstName: 'Otra', lastName: 'Invitada', email: 'otra.invitada@zenda.test' } }).expect(201);
      expect(JSON.stringify(response.body)).not.toContain('developmentToken');
      const event = await prisma.notificationOutbox.findFirstOrThrow({ where: { aggregateId: response.body.id, eventType: 'PATIENT_INVITED' } });
      expect(JSON.stringify(event.payload)).not.toContain('token');
    } finally { process.env.NODE_ENV = previous; if (previousKey === undefined) delete process.env.NOTIFICATION_OUTBOX_ENCRYPTION_KEY; else process.env.NOTIFICATION_OUTBOX_ENCRYPTION_KEY = previousKey; }
  });

  it.each([
    [{ firstName: 'Ana', lastName: 'Pérez' }, 'patient.email'],
    [{ email: 42, firstName: 'Ana', lastName: 'Pérez' }, 'patient.email'],
    [{ email: 'invalido', firstName: 'Ana', lastName: 'Pérez' }, 'patient.email'],
    [{ email: 'ana@example.test', firstName: {}, lastName: 'Pérez' }, 'patient.firstName'],
    [{ email: 'ana@example.test', firstName: 'Ana', lastName: '  ' }, 'patient.lastName'],
    [{ email: 'ana@example.test', firstName: 'Ana', lastName: 'Pérez', phone: 1234 }, 'patient.phone'],
  ])('rechaza datos inválidos sin iniciar invitación ni crear cita (%s)', async (patient, field) => {
    const response = await request(app).post('/api/doctors/me/appointments').set('Authorization', `Bearer ${doctorToken}`).send({ clinicId, serviceId, startsAt: '2026-10-05T09:00:00-05:00', sendEmail: false, patient }).expect(422);
    expect(response.body).toMatchObject({ error: 'VALIDATION_ERROR' });
    expect(response.body.fields[field]).toBeTruthy();
    expect(await prisma.patientInvitation.count()).toBe(0);
    expect(await prisma.appointment.count()).toBe(0);
  });
});
