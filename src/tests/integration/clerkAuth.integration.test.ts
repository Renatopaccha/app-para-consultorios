jest.mock('../../services/clerkSession.service', () => ({
  clerkSessionMiddleware: () => (_req: unknown, _res: unknown, next: () => void) => next(),
  resolveClerkSession: jest.fn(),
  resolveVerifiedClerkIdentity: jest.fn(),
}));
jest.mock('../../services/clerkMfa.service', () => ({
  getClerkMfaStatus: jest.fn(),
  requiresMfa: (role: string) => ['DOCTOR', 'CLINIC_ADMIN', 'ASSISTANT', 'SUPER_ADMIN'].includes(role),
}));

import bcrypt from 'bcrypt';
import { createHmac } from 'crypto';
import request from 'supertest';
import app from '../../app';
import prisma, { disconnectPrisma } from '../../prisma';
import { resolveClerkSession, resolveVerifiedClerkIdentity } from '../../services/clerkSession.service';
import { getClerkMfaStatus } from '../../services/clerkMfa.service';
import { linkClerkIdentity } from '../../services/authIdentityLink.service';
import { generateToken } from '../../utils/jwt';
import { assertIntegrationDatabase, clearIntegrationDatabase } from './testDatabase';

const clerkSessionMock = jest.mocked(resolveClerkSession);
const verifiedClerkIdentityMock = jest.mocked(resolveVerifiedClerkIdentity);
const clerkMfaMock = jest.mocked(getClerkMfaStatus);

function clerkWebhookHeaders(payload: string, secretValue: string, id: string) {
  const timestamp = Math.floor(Date.now() / 1000).toString();
  const secret = Buffer.from(secretValue);
  const signature = createHmac('sha256', secret)
    .update(`${id}.${timestamp}.${payload}`)
    .digest('base64');
  return {
    'svix-id': id,
    'svix-timestamp': timestamp,
    'svix-signature': `v1,${signature}`,
  };
}

describe('adaptador Clerk/JWT con PostgreSQL real', () => {
  beforeEach(async () => {
    assertIntegrationDatabase();
    await clearIntegrationDatabase();
    jest.clearAllMocks();
    clerkSessionMock.mockReturnValue(null);
    verifiedClerkIdentityMock.mockResolvedValue(null);
    clerkMfaMock.mockResolvedValue({ enabled: true, totpEnabled: true, backupCodeEnabled: true });
  });
  afterAll(async () => { await clearIntegrationDatabase(); await disconnectPrisma(); });

  it('devuelve el mismo DTO /me para JWT legacy y una identidad Clerk enlazada', async () => {
    const user = await prisma.user.create({ data: { email: 'clerk.doctor@zenda.test', emailNormalized: 'clerk.doctor@zenda.test', firstName: 'Ada', lastName: 'Clerk', passwordHash: 'legacy-hash', role: 'DOCTOR', clerkUserId: 'user_clerk_doctor' } });
    await prisma.doctorProfile.create({ data: { userId: user.id, licenseNumber: 'CLERK-DOCTOR-1', consultationPrice: 50 } });

    const legacy = await request(app).get('/api/auth/me').set('Authorization', `Bearer ${generateToken({ id: user.id, role: 'PATIENT' })}`).expect(200);
    clerkSessionMock.mockReturnValue({ clerkUserId: 'user_clerk_doctor', sessionId: 'sess_clerk_doctor' });
    const clerk = await request(app).get('/api/auth/me').set('Authorization', 'Bearer clerk-session-token-not-logged').expect(200);

    expect(clerk.body).toEqual(legacy.body);
    expect(clerk.body).toMatchObject({ id: user.id, role: 'DOCTOR' });
    expect(JSON.stringify(clerk.body)).not.toContain('clerk-session-token-not-logged');
    expect(clerk.body).not.toHaveProperty('clerkUserId');
  });

  it('aprovisiona signup Clerk por webhook y permite GET /api/auth/me como PATIENT', async () => {
    const secretValue = 'zenda-clerk-webhook-integration-secret';
    process.env.CLERK_WEBHOOK_SIGNING_SECRET = `whsec_${Buffer.from(secretValue).toString('base64')}`;
    const payload = JSON.stringify({
      type: 'user.created',
      object: 'event',
      data: {
        id: 'user_clerk_new_patient',
        primary_email_address_id: 'idn_new_patient',
        email_addresses: [{
          id: 'idn_new_patient',
          email_address: 'New.Clerk.Patient@zenda.test',
          verification: { status: 'verified' },
        }],
        public_metadata: { role: 'DOCTOR' },
      },
    });

    await request(app)
      .post('/api/webhooks/clerk')
      .set('Content-Type', 'application/json')
      .set(clerkWebhookHeaders(payload, secretValue, 'msg_new_patient'))
      .send(payload)
      .expect(200, { received: true, created: true });

    await request(app)
      .post('/api/webhooks/clerk')
      .set('Content-Type', 'application/json')
      .set(clerkWebhookHeaders(payload, secretValue, 'msg_new_patient_retry'))
      .send(payload)
      .expect(200, { received: true, duplicate: true });

    expect(await prisma.user.count({ where: { clerkUserId: 'user_clerk_new_patient' } })).toBe(1);
    expect(await prisma.user.findUniqueOrThrow({ where: { clerkUserId: 'user_clerk_new_patient' } })).toMatchObject({
      email: 'new.clerk.patient@zenda.test',
      emailNormalized: 'new.clerk.patient@zenda.test',
      role: 'PATIENT',
    });

    clerkSessionMock.mockReturnValue({ clerkUserId: 'user_clerk_new_patient', sessionId: 'sess_new_patient' });
    const me = await request(app)
      .get('/api/auth/me')
      .set('Authorization', 'Bearer clerk-session-token-not-logged')
      .expect(200);
    expect(me.body).toMatchObject({ email: 'new.clerk.patient@zenda.test', role: 'PATIENT' });
    delete process.env.CLERK_WEBHOOK_SIGNING_SECRET;
  });

  it('permite que el mismo doctor enlazado cargue las rutas de lectura iniciales del panel con Clerk', async () => {
    const user = await prisma.user.create({ data: { email: 'clerk.panel@zenda.test', emailNormalized: 'clerk.panel@zenda.test', firstName: 'Panel', lastName: 'Clerk', passwordHash: 'legacy-hash', role: 'DOCTOR', clerkUserId: 'user_clerk_panel' } });
    const profile = await prisma.doctorProfile.create({ data: { userId: user.id, licenseNumber: 'CLERK-PANEL-1', consultationPrice: 50 } });
    clerkSessionMock.mockReturnValue({ clerkUserId: user.clerkUserId!, sessionId: 'sess_clerk_panel' });
    const token = 'clerk-panel-session-token';

    const responses = await Promise.all([
      request(app).get('/api/auth/me'),
      request(app).get('/api/doctors/me/dashboard-summary'),
      request(app).get('/api/doctors/me/workspaces'),
      request(app).get('/api/doctors/me/profile'),
      request(app).get('/api/doctors/me/services'),
      request(app).get('/api/doctors/me/work-schedules'),
      request(app).get('/api/schedule-blocks'),
      request(app).get('/api/cash-payments/pending'),
      request(app).get('/api/finance/summary'),
      request(app).get('/api/doctors/me/reviews'),
      request(app).get('/api/doctors/me/certifications'),
      request(app).get('/api/notifications'),
    ].map((requestBuilder) => requestBuilder.set('Authorization', `Bearer ${token}`)));

    expect(responses.map((response) => response.status)).toEqual(Array(12).fill(200));
    expect(responses[0]!.body).toMatchObject({ id: user.id, profile: { doctorProfileId: profile.id } });
    expect(
      responses.every(
        (response) => !JSON.stringify(response.body).includes(token),
      ),
    ).toBe(true);
  });

  it.each([
    ['DOCTOR', 'professional', '/dashboard'],
    ['CLINIC_ADMIN', 'clinic', '/portal/clinica'],
    ['ASSISTANT', 'assistant', '/portal/asistente'],
  ] as const)('resuelve el portal %s para el rol %s desde PostgreSQL', async (role, portal, destination) => {
    const user = await prisma.user.create({ data: { email: `${role.toLowerCase()}-portal@zenda.test`, emailNormalized: `${role.toLowerCase()}-portal@zenda.test`, firstName: 'Portal', lastName: role, passwordHash: 'legacy-hash', role } });

    const response = await request(app)
      .post('/api/auth/resolve-portal')
      // The token claim deliberately disagrees; middleware reloads the role from PostgreSQL.
      .set('Authorization', `Bearer ${generateToken({ id: user.id, role: 'PATIENT' })}`)
      .send({ portal })
      .expect(200);

    expect(response.body).toEqual({ portal, allowed: true, destination });
  });

  it('rechaza los demás portales para DOCTOR y devuelve solamente los portales derivados del rol', async () => {
    const doctor = await prisma.user.create({ data: { email: 'portal-doctor@zenda.test', emailNormalized: 'portal-doctor@zenda.test', firstName: 'Portal', lastName: 'Doctor', passwordHash: 'legacy-hash', role: 'DOCTOR' } });
    const token = generateToken({ id: doctor.id, role: 'DOCTOR' });

    for (const portal of ['clinic', 'assistant']) {
      const response = await request(app).post('/api/auth/resolve-portal').set('Authorization', `Bearer ${token}`).send({ portal }).expect(403);
      expect(response.body).toEqual(expect.objectContaining({ code: 'PORTAL_ACCESS_DENIED', requestedPortal: portal, availablePortals: ['professional'] }));
    }
  });

  it.each(['professional', 'clinic', 'assistant'] as const)('rechaza el portal %s para PATIENT y SUPER_ADMIN sin acceso implícito', async (portal) => {
    const [patient, superAdmin] = await Promise.all([
      prisma.user.create({ data: { email: `patient-${portal}@zenda.test`, emailNormalized: `patient-${portal}@zenda.test`, firstName: 'Patient', lastName: portal, passwordHash: 'legacy-hash', role: 'PATIENT' } }),
      prisma.user.create({ data: { email: `super-${portal}@zenda.test`, emailNormalized: `super-${portal}@zenda.test`, firstName: 'Super', lastName: portal, passwordHash: 'legacy-hash', role: 'SUPER_ADMIN' } }),
    ]);

    for (const user of [patient, superAdmin]) {
      const response = await request(app).post('/api/auth/resolve-portal').set('Authorization', `Bearer ${generateToken({ id: user.id, role: user.role })}`).send({ portal }).expect(403);
      expect(response.body).toEqual(expect.objectContaining({ code: 'PORTAL_ACCESS_DENIED', requestedPortal: portal, availablePortals: [] }));
    }
  });

  it('ignora query roles y rechaza cuerpos manipulados sin modificar el rol del usuario', async () => {
    const doctor = await prisma.user.create({ data: { email: 'portal-tamper@zenda.test', emailNormalized: 'portal-tamper@zenda.test', firstName: 'Portal', lastName: 'Tamper', passwordHash: 'legacy-hash', role: 'DOCTOR' } });
    const token = generateToken({ id: doctor.id, role: 'DOCTOR' });

    await request(app).post('/api/auth/resolve-portal?role=ASSISTANT').set('Authorization', `Bearer ${token}`).send({ portal: 'assistant' }).expect(403);
    await request(app).post('/api/auth/resolve-portal').set('Authorization', `Bearer ${token}`).send({ portal: 'professional', role: 'ASSISTANT' }).expect(400);

    expect((await prisma.user.findUniqueOrThrow({ where: { id: doctor.id } })).role).toBe('DOCTOR');
  });

  it('aplica MFA antes de resolver un portal Clerk y una identidad no enlazada no recibe acceso', async () => {
    const doctor = await prisma.user.create({ data: { email: 'portal-mfa@zenda.test', emailNormalized: 'portal-mfa@zenda.test', firstName: 'Portal', lastName: 'Mfa', passwordHash: 'legacy-hash', role: 'DOCTOR', clerkUserId: 'user_portal_mfa' } });
    clerkSessionMock.mockReturnValue({ clerkUserId: doctor.clerkUserId!, sessionId: 'sess_portal_mfa' });
    clerkMfaMock.mockResolvedValue({ enabled: false, totpEnabled: false, backupCodeEnabled: false });
    await request(app).post('/api/auth/resolve-portal').set('Authorization', 'Bearer clerk-session-token-not-logged').send({ portal: 'professional' }).expect(403).expect(({ body }) => expect(body.code).toBe('MFA_SETUP_REQUIRED'));

    clerkSessionMock.mockReturnValue({ clerkUserId: 'user_portal_unlinked', sessionId: 'sess_portal_unlinked' });
    await request(app).post('/api/auth/resolve-portal').set('Authorization', 'Bearer clerk-session-token-not-logged').send({ portal: 'professional' }).expect(403).expect(({ body }) => expect(body.code).toBe('CLERK_IDENTITY_NOT_LINKED'));
  });

  it('does not create or link a user when Clerk identity is unknown', async () => {
    clerkSessionMock.mockReturnValue({ clerkUserId: 'user_unknown', sessionId: 'sess_unknown' });
    const response = await request(app).get('/api/auth/me').set('Authorization', 'Bearer clerk-session-token-not-logged').expect(403);
    expect(response.body).toMatchObject({ code: 'CLERK_IDENTITY_NOT_LINKED' });
    expect(await prisma.user.count()).toBe(0);
    expect(JSON.stringify(response.body)).not.toContain('clerk-session-token-not-logged');
  });

  it.each(['DOCTOR', 'CLINIC_ADMIN', 'ASSISTANT', 'SUPER_ADMIN'] as const)('returns MFA_SETUP_REQUIRED for linked %s without MFA', async (role) => {
    const user = await prisma.user.create({ data: { email: `${role.toLowerCase()}-mfa@zenda.test`, emailNormalized: `${role.toLowerCase()}-mfa@zenda.test`, firstName: 'Mfa', lastName: role, passwordHash: 'legacy-hash', role, clerkUserId: `user_${role}_mfa` } });
    clerkSessionMock.mockReturnValue({ clerkUserId: user.clerkUserId!, sessionId: 'sess_mfa' });
    clerkMfaMock.mockResolvedValue({ enabled: false, totpEnabled: false, backupCodeEnabled: false });

    const response = await request(app).get('/api/auth/me').set('Authorization', 'Bearer clerk-session-token-not-logged').expect(403);
    expect(response.body).toEqual(expect.objectContaining({ code: 'MFA_SETUP_REQUIRED', mfa: { required: true, enabled: false } }));
    expect(JSON.stringify(response.body)).not.toContain('clerk-session-token-not-logged');
  });

  it('allows a linked PATIENT without MFA and fails closed when a professional MFA lookup fails', async () => {
    const patient = await prisma.user.create({ data: { email: 'patient-mfa@zenda.test', emailNormalized: 'patient-mfa@zenda.test', firstName: 'Patient', lastName: 'Mfa', passwordHash: 'legacy-hash', role: 'PATIENT', clerkUserId: 'user_patient_mfa' } });
    clerkSessionMock.mockReturnValue({ clerkUserId: patient.clerkUserId!, sessionId: 'sess_patient_mfa' });
    await request(app).get('/api/auth/me').set('Authorization', 'Bearer clerk-session-token-not-logged').expect(200);
    expect(clerkMfaMock).not.toHaveBeenCalled();

    const doctor = await prisma.user.create({ data: { email: 'doctor-unavailable@zenda.test', emailNormalized: 'doctor-unavailable@zenda.test', firstName: 'Doctor', lastName: 'Unavailable', passwordHash: 'legacy-hash', role: 'DOCTOR', clerkUserId: 'user_doctor_unavailable' } });
    clerkSessionMock.mockReturnValue({ clerkUserId: doctor.clerkUserId!, sessionId: 'sess_doctor_unavailable' });
    clerkMfaMock.mockRejectedValue(new Error('unavailable'));
    await request(app).get('/api/auth/me').set('Authorization', 'Bearer clerk-session-token-not-logged').expect(503).expect(({ body }) => expect(body.code).toBe('MFA_STATUS_UNAVAILABLE'));
  });

  it('rejects a legacy and Clerk session that resolve to different Zenda users', async () => {
    const [legacyUser, clerkUser] = await Promise.all([
      prisma.user.create({ data: { email: 'legacy@zenda.test', emailNormalized: 'legacy@zenda.test', firstName: 'Legacy', lastName: 'User', passwordHash: 'x', role: 'DOCTOR' } }),
      prisma.user.create({ data: { email: 'clerk@zenda.test', emailNormalized: 'clerk@zenda.test', firstName: 'Clerk', lastName: 'User', passwordHash: 'x', role: 'PATIENT', clerkUserId: 'user_conflicting' } }),
    ]);
    clerkSessionMock.mockReturnValue({ clerkUserId: 'user_conflicting', sessionId: 'sess_conflicting' });
    const response = await request(app).get('/api/auth/me').set('Authorization', `Bearer ${generateToken({ id: legacyUser.id, role: 'DOCTOR' })}`).expect(401);
    expect(response.body).toMatchObject({ code: 'AUTH_IDENTITY_CONFLICT' });
    expect(response.body).not.toHaveProperty('token');
    expect(clerkUser.id).not.toBe(legacyUser.id);
  });

  it('enforces unique Clerk IDs and records one durable link under concurrent attempts', async () => {
    const [first, second] = await Promise.all([
      prisma.user.create({ data: { email: 'link-first@zenda.test', emailNormalized: 'link-first@zenda.test', firstName: 'First', lastName: 'Link', passwordHash: 'x', role: 'DOCTOR' } }),
      prisma.user.create({ data: { email: 'link-second@zenda.test', emailNormalized: 'link-second@zenda.test', firstName: 'Second', lastName: 'Link', passwordHash: 'x', role: 'PATIENT' } }),
    ]);
    const results = await Promise.allSettled([
      linkClerkIdentity({ userId: first.id, clerkUserId: 'user_one_time_link' }),
      linkClerkIdentity({ userId: second.id, clerkUserId: 'user_one_time_link' }),
    ]);
    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    expect(await prisma.user.count({ where: { clerkUserId: 'user_one_time_link' } })).toBe(1);
    expect(await prisma.authIdentityLinkAudit.count({ where: { clerkUserId: 'user_one_time_link', event: 'LINKED' } })).toBe(1);
  });

  it('links a verified Clerk identity only after legacy reauthentication and preserves the doctor profile', async () => {
    const passwordHash = await bcrypt.hash('test-link-password', 4);
    const user = await prisma.user.create({ data: { email: 'link.doctor@zenda.test', emailNormalized: 'link.doctor@zenda.test', firstName: 'Link', lastName: 'Doctor', passwordHash, role: 'DOCTOR' } });
    const profile = await prisma.doctorProfile.create({ data: { userId: user.id, licenseNumber: 'LINK-DOCTOR-001', consultationPrice: 50 } });
    verifiedClerkIdentityMock.mockResolvedValue({ clerkUserId: 'user_link_doctor', sessionId: 'sess_link_doctor', email: 'Link.Doctor@Zenda.test' });

    const response = await request(app).post('/api/auth/clerk/link-existing-account').set('Authorization', 'Bearer clerk-session-token-not-logged').send({ password: 'test-link-password', portal: 'professional' }).expect(200);
    expect(response.body).toEqual({ linked: true, alreadyLinked: false, user: { id: user.id, role: 'DOCTOR' } });

    const linkedUser = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });
    expect(linkedUser).toMatchObject({ id: user.id, passwordHash, clerkUserId: 'user_link_doctor', role: 'DOCTOR' });
    expect(await prisma.doctorProfile.findUniqueOrThrow({ where: { id: profile.id } })).toMatchObject({ id: profile.id, userId: user.id });
    expect(await prisma.authIdentityLinkAudit.count({ where: { userId: user.id, clerkUserId: 'user_link_doctor', event: 'LINKED' } })).toBe(1);

    clerkSessionMock.mockReturnValue({ clerkUserId: 'user_link_doctor', sessionId: 'sess_link_doctor' });
    const clerkMe = await request(app).get('/api/auth/me').set('Authorization', 'Bearer clerk-session-token-not-logged').expect(200);
    expect(clerkMe.body).toMatchObject({ id: user.id, role: 'DOCTOR', profile: { doctorProfileId: profile.id } });
    expect(JSON.stringify(clerkMe.body)).not.toContain('clerk-session-token-not-logged');
  });

  it('rejects an invalid legacy password without linking or leaking credentials', async () => {
    const passwordHash = await bcrypt.hash('correct-password', 4);
    const user = await prisma.user.create({ data: { email: 'wrong.password@zenda.test', emailNormalized: 'wrong.password@zenda.test', firstName: 'Wrong', lastName: 'Password', passwordHash, role: 'DOCTOR' } });
    verifiedClerkIdentityMock.mockResolvedValue({ clerkUserId: 'user_wrong_password', sessionId: 'sess_wrong_password', email: user.email });

    const response = await request(app).post('/api/auth/clerk/link-existing-account').send({ password: 'not-the-password', portal: 'professional' }).expect(401);
    expect(response.body).toMatchObject({ code: 'LINK_REAUTH_FAILED' });
    expect(JSON.stringify(response.body)).not.toContain('not-the-password');
    expect((await prisma.user.findUniqueOrThrow({ where: { id: user.id } })).clerkUserId).toBeNull();
    expect(await prisma.authIdentityLinkAudit.count({ where: { userId: user.id, clerkUserId: 'user_wrong_password', event: 'LINK_REJECTED' } })).toBe(1);
  });

  it('rejects different, unknown, or unverified Clerk emails without creating users', async () => {
    const passwordHash = await bcrypt.hash('known-password', 4);
    const existing = await prisma.user.create({ data: { email: 'existing.email@zenda.test', emailNormalized: 'existing.email@zenda.test', firstName: 'Existing', lastName: 'Email', passwordHash, role: 'DOCTOR' } });
    const existingProfile = await prisma.doctorProfile.create({ data: { userId: existing.id, licenseNumber: 'NO-AUTO-LINK-001', consultationPrice: 50 } });
    verifiedClerkIdentityMock.mockResolvedValue({ clerkUserId: 'user_different_email', sessionId: 'sess_different_email', email: 'different.email@zenda.test' });
    await request(app).post('/api/auth/clerk/link-existing-account').send({ password: 'known-password', portal: 'professional' }).expect(401).expect(({ body }) => expect(body.code).toBe('LINK_REAUTH_FAILED'));
    expect(await prisma.user.count()).toBe(1);
    expect(await prisma.user.findUniqueOrThrow({ where: { id: existing.id } })).toMatchObject({ clerkUserId: null });
    expect(await prisma.doctorProfile.count()).toBe(1);
    expect(await prisma.doctorProfile.findUniqueOrThrow({ where: { id: existingProfile.id } })).toMatchObject({ userId: existing.id });

    verifiedClerkIdentityMock.mockResolvedValue(null);
    await request(app).post('/api/auth/clerk/link-existing-account').send({ password: 'known-password', portal: 'professional' }).expect(401).expect(({ body }) => expect(body.code).toBe('CLERK_VERIFIED_SESSION_REQUIRED'));
    expect(await prisma.user.count()).toBe(1);
  });

  it('is idempotent for the same identity and rejects both kinds of collision with durable audits', async () => {
    const passwordHash = await bcrypt.hash('collision-password', 4);
    const user = await prisma.user.create({ data: { email: 'collision.owner@zenda.test', emailNormalized: 'collision.owner@zenda.test', firstName: 'Collision', lastName: 'Owner', passwordHash, role: 'DOCTOR', clerkUserId: 'user_same_link' } });
    verifiedClerkIdentityMock.mockResolvedValue({ clerkUserId: 'user_same_link', sessionId: 'sess_same_link', email: user.email });
    await request(app).post('/api/auth/clerk/link-existing-account').send({ password: 'collision-password', portal: 'professional' }).expect(200).expect(({ body }) => expect(body).toMatchObject({ linked: true, alreadyLinked: true, user: { id: user.id } }));
    expect(await prisma.authIdentityLinkAudit.count({ where: { userId: user.id, event: 'LINKED' } })).toBe(0);

    await prisma.user.create({ data: { email: 'collision.other@zenda.test', emailNormalized: 'collision.other@zenda.test', firstName: 'Collision', lastName: 'Other', passwordHash, role: 'PATIENT', clerkUserId: 'user_owned_elsewhere' } });
    const target = await prisma.user.create({ data: { email: 'collision.target@zenda.test', emailNormalized: 'collision.target@zenda.test', firstName: 'Collision', lastName: 'Target', passwordHash, role: 'DOCTOR' } });
    verifiedClerkIdentityMock.mockResolvedValue({ clerkUserId: 'user_owned_elsewhere', sessionId: 'sess_owned_elsewhere', email: target.email });
    await request(app).post('/api/auth/clerk/link-existing-account').send({ password: 'collision-password', portal: 'professional' }).expect(409).expect(({ body }) => expect(body.code).toBe('CLERK_IDENTITY_LINK_CONFLICT'));
    expect(await prisma.authIdentityLinkAudit.count({ where: { userId: target.id, clerkUserId: 'user_owned_elsewhere', event: 'COLLISION' } })).toBe(1);

    verifiedClerkIdentityMock.mockResolvedValue({ clerkUserId: 'user_new_clerk_identity', sessionId: 'sess_new_clerk_identity', email: user.email });
    await request(app).post('/api/auth/clerk/link-existing-account').send({ password: 'collision-password', portal: 'professional' }).expect(409);
    expect(await prisma.authIdentityLinkAudit.count({ where: { userId: user.id, clerkUserId: 'user_new_clerk_identity', event: 'COLLISION' } })).toBe(1);
  });

  it('allows concurrent attempts for one account to produce exactly one real link', async () => {
    const passwordHash = await bcrypt.hash('concurrent-password', 4);
    const user = await prisma.user.create({ data: { email: 'concurrent.link@zenda.test', emailNormalized: 'concurrent.link@zenda.test', firstName: 'Concurrent', lastName: 'Link', passwordHash, role: 'DOCTOR' } });
    verifiedClerkIdentityMock.mockResolvedValue({ clerkUserId: 'user_concurrent_link', sessionId: 'sess_concurrent_link', email: user.email });

    const responses = await Promise.all([
      request(app).post('/api/auth/clerk/link-existing-account').send({ password: 'concurrent-password', portal: 'professional' }),
      request(app).post('/api/auth/clerk/link-existing-account').send({ password: 'concurrent-password', portal: 'professional' }),
    ]);
    expect(responses.map((response) => response.status).sort()).toEqual([200, 200]);
    expect(await prisma.user.count({ where: { clerkUserId: 'user_concurrent_link' } })).toBe(1);
    expect(await prisma.authIdentityLinkAudit.count({ where: { userId: user.id, clerkUserId: 'user_concurrent_link', event: 'LINKED' } })).toBe(1);
  });

  it('requires a verified Clerk session and never accepts a Clerk ID from the body', async () => {
    await request(app).post('/api/auth/clerk/link-existing-account').send({ password: 'some-password', portal: 'professional' }).expect(401);
    verifiedClerkIdentityMock.mockResolvedValue({ clerkUserId: 'user_real_identity', sessionId: 'sess_real_identity', email: 'nobody@zenda.test' });
    await request(app).post('/api/auth/clerk/link-existing-account').send({ password: 'some-password', portal: 'professional', clerkUserId: 'user_attacker_controlled' }).expect(400);
    expect(await prisma.user.count({ where: { clerkUserId: 'user_attacker_controlled' } })).toBe(0);
  });
});
