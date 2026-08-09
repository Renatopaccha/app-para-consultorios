import bcrypt from 'bcrypt';
import request from 'supertest';
import app from '../../app';
import prisma, { disconnectPrisma } from '../../prisma';
import { clearIntegrationDatabase, assertIntegrationDatabase } from './testDatabase';
import { generateToken } from '../../utils/jwt';
import { setInvitationEmailAdapterForTests } from '../../services/email.service';

const adminHeaders = () => ({ Authorization: `Bearer ${generateToken({ id: adminId, role: 'SUPER_ADMIN' })}` });
let adminId = '';
const deliveredInvitations: Array<{ to: string; token: string }> = [];

describe('onboarding profesional con PostgreSQL real', () => {
  beforeEach(async () => {
    assertIntegrationDatabase();
    setInvitationEmailAdapterForTests(async ({ to, token }) => { deliveredInvitations.push({ to, token }); });
    await clearIntegrationDatabase();
    const admin = await prisma.user.create({
      data: {
        email: 'admin.integration@zenda.test', emailNormalized: 'admin.integration@zenda.test', firstName: 'Admin', lastName: 'Integration',
        passwordHash: await bcrypt.hash('integration-password-123', 10), role: 'SUPER_ADMIN',
      },
    });
    adminId = admin.id;
  });

  afterAll(async () => {
    await clearIntegrationDatabase();
    setInvitationEmailAdapterForTests(undefined);
    await disconnectPrisma();
  });

  it('crea, persiste hasheada, valida y acepta una invitación médica una sola vez', async () => {
    const create = await request(app)
      .post('/api/admin/invitations').set(adminHeaders())
      .send({ email: 'medico.integration@zenda.test', role: 'DOCTOR' })
      .expect(201);
    const rawToken: string = create.body.developmentToken;
    expect(rawToken).toBeTruthy();
    expect(deliveredInvitations.at(-1)).toMatchObject({ to: 'medico.integration@zenda.test', token: rawToken });

    const invitation = await prisma.invitation.findUnique({ where: { id: create.body.invitation.id } });
    expect(invitation?.tokenHash).not.toBe(rawToken);
    expect(invitation?.tokenHash).toHaveLength(64);

    await request(app).get('/api/auth/invitations/validate').query({ token: rawToken }).expect(200);
    const accepted = await request(app).post('/api/auth/accept-invitation').send({
      token: rawToken, firstName: 'Médica', lastName: 'Real', password: 'integration-password-123',
      licenseNumber: 'INT-001', consultationPrice: 45,
    }).expect(201);
    expect(accepted.body.verificationStatus).toBe('PENDING');

    const doctor = await prisma.doctorProfile.findUnique({ where: { userId: accepted.body.user.id } });
    expect(doctor).toMatchObject({ verificationStatus: 'PENDING', isVerified: false, licenseNumber: 'INT-001' });
    await request(app).post('/api/auth/accept-invitation').send({
      token: rawToken, firstName: 'Otra', lastName: 'Persona', password: 'integration-password-123',
      licenseNumber: 'INT-002', consultationPrice: 45,
    }).expect(410);
  });

  it('rechaza una URL de prueba insegura antes de crear conexiones', () => {
    const original = process.env.TEST_DATABASE_URL;
    process.env.TEST_DATABASE_URL = 'postgresql://user:pass@remote.example.com:5432/production';
    expect(() => assertIntegrationDatabase()).toThrow('fue rechazada');
    process.env.TEST_DATABASE_URL = original;
  });

  it('acepta concurrentemente una invitación una sola vez y conserva una única asociación', async () => {
    const clinicAdmin = await prisma.user.create({
      data: { email: 'clinica.integration@zenda.test', emailNormalized: 'clinica.integration@zenda.test', firstName: 'Clínica', lastName: 'Anfitriona', passwordHash: 'x', role: 'CLINIC_ADMIN' },
    });
    const clinic = await prisma.clinicProfile.create({ data: { userId: clinicAdmin.id, name: 'Clínica Test', address: 'Calle Test' } });
    const created = await request(app).post('/api/admin/invitations').set(adminHeaders())
      .send({ email: 'concurrente.integration@zenda.test', role: 'DOCTOR', clinicProfileId: clinic.id }).expect(201);
    const payload = { token: created.body.developmentToken, firstName: 'Doc', lastName: 'Concurrente', password: 'integration-password-123', licenseNumber: 'CON-001', consultationPrice: 10 };
    const results = await Promise.allSettled([
      request(app).post('/api/auth/accept-invitation').send(payload),
      request(app).post('/api/auth/accept-invitation').send(payload),
    ]);
    const statuses = results.map((result) => result.status === 'fulfilled' ? result.value.status : 0).sort();
    expect(statuses).toEqual([201, 410]);
    expect(await prisma.user.count({ where: { email: 'concurrente.integration@zenda.test' } })).toBe(1);
    expect(await prisma.doctorProfile.count({ where: { licenseNumber: 'CON-001' } })).toBe(1);
    expect(await prisma.doctorClinicWorkplace.count({ where: { clinicProfileId: clinic.id } })).toBe(1);
    expect(await prisma.invitation.count({ where: { id: created.body.invitation.id, acceptedAt: { not: null } } })).toBe(1);
  });

  it('revoca, vence y reenvía tokens sin permitir su reutilización', async () => {
    const revoked = await request(app).post('/api/admin/invitations').set(adminHeaders())
      .send({ email: 'revocada.integration@zenda.test', role: 'DOCTOR' }).expect(201);
    await request(app).post(`/api/admin/invitations/${revoked.body.invitation.id}/revoke`).set(adminHeaders()).expect(200);
    await request(app).post('/api/auth/accept-invitation').send({ token: revoked.body.developmentToken, firstName: 'A', lastName: 'B', password: 'integration-password-123', licenseNumber: 'REV-001', consultationPrice: 1 }).expect(410);

    const resend = await request(app).post('/api/admin/invitations').set(adminHeaders())
      .send({ email: 'reenviada.integration@zenda.test', role: 'DOCTOR' }).expect(201);
    const replacement = await request(app).post(`/api/admin/invitations/${resend.body.invitation.id}/resend`).set(adminHeaders()).expect(200);
    await request(app).post('/api/auth/accept-invitation').send({ token: resend.body.developmentToken, firstName: 'A', lastName: 'B', password: 'integration-password-123', licenseNumber: 'RES-OLD', consultationPrice: 1 }).expect(410);
    await prisma.invitation.update({ where: { id: replacement.body.invitation.id }, data: { expiresAt: new Date(Date.now() - 1_000) } });
    await request(app).post('/api/auth/accept-invitation').send({ token: replacement.body.developmentToken, firstName: 'A', lastName: 'B', password: 'integration-password-123', licenseNumber: 'RES-NEW', consultationPrice: 1 }).expect(410);
  });

  it('revierte la transacción si una restricción real impide crear el perfil médico', async () => {
    const existingUser = await prisma.user.create({ data: { email: 'licencia-existente@zenda.test', emailNormalized: 'licencia-existente@zenda.test', firstName: 'Existente', lastName: 'Doctor', passwordHash: 'x', role: 'DOCTOR' } });
    await prisma.doctorProfile.create({ data: { userId: existingUser.id, licenseNumber: 'DUP-001', consultationPrice: 1 } });
    const invite = await request(app).post('/api/admin/invitations').set(adminHeaders())
      .send({ email: 'fallo-perfil@zenda.test', role: 'DOCTOR' }).expect(201);
    await request(app).post('/api/auth/accept-invitation').send({ token: invite.body.developmentToken, firstName: 'Fallo', lastName: 'Perfil', password: 'integration-password-123', licenseNumber: 'DUP-001', consultationPrice: 1 }).expect(500);
    expect(await prisma.user.count({ where: { email: 'fallo-perfil@zenda.test' } })).toBe(0);
    expect(await prisma.invitation.count({ where: { id: invite.body.invitation.id, acceptedAt: null } })).toBe(1);
  });

  it('revierte perfil de clínica y asociación médico-clínica ante fallos SQL temporales de pruebas', async () => {
    await prisma.$executeRawUnsafe(`CREATE OR REPLACE FUNCTION zenda_test_reject_insert() RETURNS trigger AS $$ BEGIN RAISE EXCEPTION 'test fixture rejection'; END; $$ LANGUAGE plpgsql`);
    try {
      await prisma.$executeRawUnsafe(`CREATE TRIGGER zenda_test_reject_clinic BEFORE INSERT ON "ClinicProfile" FOR EACH ROW EXECUTE FUNCTION zenda_test_reject_insert()`);
      const clinicInvite = await request(app).post('/api/admin/invitations').set(adminHeaders())
        .send({ email: 'fallo-clinica@zenda.test', role: 'CLINIC_ADMIN' }).expect(201);
      await request(app).post('/api/auth/accept-invitation').send({ token: clinicInvite.body.developmentToken, firstName: 'Fallo', lastName: 'Clínica', password: 'integration-password-123', name: 'Clínica Fallida', address: 'Dirección' }).expect(500);
      expect(await prisma.user.count({ where: { email: 'fallo-clinica@zenda.test' } })).toBe(0);
      expect(await prisma.invitation.count({ where: { id: clinicInvite.body.invitation.id, acceptedAt: null } })).toBe(1);
      await prisma.$executeRawUnsafe(`DROP TRIGGER zenda_test_reject_clinic ON "ClinicProfile"`);

      const clinicOwner = await prisma.user.create({ data: { email: 'owner@zenda.test', emailNormalized: 'owner@zenda.test', firstName: 'Owner', lastName: 'Clinic', passwordHash: 'x', role: 'CLINIC_ADMIN' } });
      const clinic = await prisma.clinicProfile.create({ data: { userId: clinicOwner.id, name: 'Clinic Owner', address: 'Address' } });
      await prisma.$executeRawUnsafe(`CREATE TRIGGER zenda_test_reject_workplace BEFORE INSERT ON "DoctorClinicWorkplace" FOR EACH ROW EXECUTE FUNCTION zenda_test_reject_insert()`);
      const doctorInvite = await request(app).post('/api/admin/invitations').set(adminHeaders())
        .send({ email: 'fallo-workplace@zenda.test', role: 'DOCTOR', clinicProfileId: clinic.id }).expect(201);
      await request(app).post('/api/auth/accept-invitation').send({ token: doctorInvite.body.developmentToken, firstName: 'Fallo', lastName: 'Workplace', password: 'integration-password-123', licenseNumber: 'WORK-001', consultationPrice: 1 }).expect(500);
      expect(await prisma.user.count({ where: { email: 'fallo-workplace@zenda.test' } })).toBe(0);
      expect(await prisma.invitation.count({ where: { id: doctorInvite.body.invitation.id, acceptedAt: null } })).toBe(1);
      await prisma.$executeRawUnsafe(`DROP TRIGGER zenda_test_reject_workplace ON "DoctorClinicWorkplace"`);
    } finally {
      await prisma.$executeRawUnsafe(`DROP TRIGGER IF EXISTS zenda_test_reject_clinic ON "ClinicProfile"`);
      await prisma.$executeRawUnsafe(`DROP TRIGGER IF EXISTS zenda_test_reject_workplace ON "DoctorClinicWorkplace"`);
      await prisma.$executeRawUnsafe(`DROP FUNCTION IF EXISTS zenda_test_reject_insert()`);
    }
  });
});
