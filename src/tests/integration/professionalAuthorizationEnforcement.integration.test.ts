import request from 'supertest';
import app from '../../app';
import prisma, { disconnectPrisma } from '../../prisma';
import { resetProfessionalAuthEnforcementRateLimitForTests } from '../../services/professionalAuthorizationEnforcement.service';
import { generateToken } from '../../utils/jwt';
import { assertIntegrationDatabase, clearIntegrationDatabase } from './testDatabase';

let sequence = 0;
const originalOutlookRedirectUri = process.env.OUTLOOK_REDIRECT_URI;

async function doctorFixture(input: {
  access?: 'ACTIVE' | 'SUSPENDED' | 'REVOKED' | null;
  assignment?: 'ACTIVE' | 'REVOKED' | null;
  application?: 'PENDING_REVIEW' | 'APPROVED' | null;
} = {}) {
  sequence += 1;
  const key = `enforce-doctor-${sequence}`;
  const user = await prisma.user.create({ data: {
    firstName: 'Enforce', lastName: 'Doctor', email: `${key}@example.test`,
    emailNormalized: `${key}@example.test`, role: 'DOCTOR',
  } });
  const doctor = await prisma.doctorProfile.create({ data: {
    userId: user.id, licenseNumber: `ENFORCE-${sequence}`, consultationPrice: 50,
    verificationStatus: 'APPROVED', isVerified: true,
  } });
  if (input.application) {
    await prisma.professionalApplication.create({ data: {
      userId: user.id, cycleNumber: 1, status: input.application,
      submittedAt: new Date(), ...(input.application === 'APPROVED' ? { decidedAt: new Date() } : {}),
    } });
  }
  if (input.assignment !== null) {
    const assignedAt = new Date(Date.now() - 1_000);
    await prisma.userRoleAssignment.create({ data: {
      userId: user.id, role: 'DOCTOR', scopeKey: 'GLOBAL', source: 'LEGACY_BACKFILL', assignedAt,
      ...(input.assignment === 'REVOKED' ? { revokedAt: new Date() } : {}),
    } });
  }
  if (input.access !== null) {
    const status = input.access ?? 'ACTIVE';
    await prisma.professionalAccess.create({ data: {
      userId: user.id, doctorProfileId: doctor.id, status, source: 'LEGACY_BACKFILL', activatedAt: new Date(),
      ...(status === 'SUSPENDED' ? { suspendedAt: new Date() } : {}),
      ...(status === 'REVOKED' ? { revokedAt: new Date() } : {}),
    } });
  }
  return { user, doctor, token: generateToken({ id: user.id, role: 'DOCTOR' }) };
}

async function roleFixture(role: 'CLINIC_ADMIN' | 'ASSISTANT' | 'SUPER_ADMIN' | 'PATIENT') {
  sequence += 1;
  const key = `enforce-${role.toLowerCase()}-${sequence}`;
  return prisma.user.create({ data: {
    firstName: 'Enforce', lastName: role, email: `${key}@example.test`,
    emailNormalized: `${key}@example.test`, role,
  } });
}

describe('cutover ProfessionalAccess en modo enforce', () => {
  beforeAll(() => assertIntegrationDatabase());
  beforeEach(async () => {
    process.env.PROFESSIONAL_AUTH_ENFORCEMENT_MODE = 'enforce';
    process.env.OUTLOOK_REDIRECT_URI = originalOutlookRedirectUri ?? 'http://localhost:3000/api/calendar/outlook/callback';
    resetProfessionalAuthEnforcementRateLimitForTests();
    await clearIntegrationDatabase();
  });
  afterAll(async () => {
    delete process.env.PROFESSIONAL_AUTH_ENFORCEMENT_MODE;
    if (originalOutlookRedirectUri) process.env.OUTLOOK_REDIRECT_URI = originalOutlookRedirectUri;
    else delete process.env.OUTLOOK_REDIRECT_URI;
    await clearIntegrationDatabase();
    await disconnectPrisma();
  });

  it('doctor ACTIVE conserva panel, agenda, servicios, pagos, reviews, certificaciones, workspaces, calendar y portal', async () => {
    const actor = await doctorFixture({ access: 'ACTIVE', assignment: 'ACTIVE', application: 'APPROVED' });
    const getPaths = [
      '/api/doctors/me/dashboard-summary',
      '/api/doctors/me/workspaces',
      '/api/doctors/me/profile',
      '/api/doctors/me/services',
      '/api/doctors/me/work-schedules',
      '/api/schedule-blocks',
      '/api/bookings',
      '/api/turns/today',
      '/api/cash-payments/pending',
      '/api/finance/summary',
      '/api/doctors/me/reviews',
      '/api/doctors/me/certifications',
      '/api/clinics/my-clinics',
      '/api/google/auth-url',
      '/api/calendar/google/auth',
      '/api/calendar/outlook/auth',
    ];
    const responses = await Promise.all(getPaths.map((path) => request(app).get(path).set('Authorization', `Bearer ${actor.token}`)));
    expect(responses.map(({ status }) => status)).toEqual(Array(getPaths.length).fill(200));

    const portal = await request(app).post('/api/auth/resolve-portal')
      .set('Authorization', `Bearer ${actor.token}`).send({ portal: 'professional' }).expect(200);
    expect(portal.body).toEqual({ portal: 'professional', allowed: true, destination: '/dashboard' });
    expect(await prisma.user.findUniqueOrThrow({ where: { id: actor.user.id } })).toMatchObject({ id: actor.user.id, role: 'DOCTOR' });
    expect(await prisma.doctorProfile.findUniqueOrThrow({ where: { id: actor.doctor.id } })).toMatchObject({ id: actor.doctor.id, userId: actor.user.id });
  });

  it('PENDING accidental DOCTOR recibe 403 también en rutas authenticate-only y no obtiene dashboard', async () => {
    const actor = await doctorFixture({ access: null, assignment: null, application: 'PENDING_REVIEW' });
    for (const path of ['/api/doctors/me/profile', '/api/schedule-blocks', '/api/bookings', '/api/turns/today']) {
      await request(app).get(path).set('Authorization', `Bearer ${actor.token}`).expect(403)
        .expect(({ body }) => expect(body.code).toBe('PROFESSIONAL_ACCESS_REQUIRED'));
    }
    await request(app).post('/api/auth/resolve-portal')
      .set('Authorization', `Bearer ${actor.token}`).send({ portal: 'professional' }).expect(403)
      .expect(({ body }) => expect(body).toMatchObject({ code: 'PROFESSIONAL_ACCESS_REQUIRED', requestedPortal: 'professional' }));
  });

  it.each([
    ['SUSPENDED', 'PROFESSIONAL_ACCESS_SUSPENDED'],
    ['REVOKED', 'PROFESSIONAL_ACCESS_REVOKED'],
  ] as const)('%s recibe 403 sin modificar User, DoctorProfile, assignment o Application', async (status, code) => {
    const actor = await doctorFixture({ access: status, assignment: 'ACTIVE', application: 'APPROVED' });
    await request(app).get('/api/doctors/me/profile').set('Authorization', `Bearer ${actor.token}`).expect(403)
      .expect(({ body }) => expect(body.code).toBe(code));
    expect(await prisma.user.findUniqueOrThrow({ where: { id: actor.user.id } })).toMatchObject({ role: 'DOCTOR' });
    expect(await prisma.doctorProfile.findUniqueOrThrow({ where: { id: actor.doctor.id } })).toMatchObject({ userId: actor.user.id });
    expect(await prisma.userRoleAssignment.findUniqueOrThrow({
      where: { userId_role_scopeKey: { userId: actor.user.id, role: 'DOCTOR', scopeKey: 'GLOBAL' } },
    })).toMatchObject({ revokedAt: null });
    expect(await prisma.professionalApplication.findFirstOrThrow({ where: { userId: actor.user.id } })).toMatchObject({ status: 'APPROVED' });
  });

  it('assignment revocado recibe 403 aunque ProfessionalAccess esté ACTIVE', async () => {
    const actor = await doctorFixture({ access: 'ACTIVE', assignment: 'REVOKED' });
    await request(app).get('/api/doctors/me/profile').set('Authorization', `Bearer ${actor.token}`).expect(403)
      .expect(({ body }) => expect(body.code).toBe('PROFESSIONAL_ROLE_REVOKED'));
  });

  it('profile mismatch falla cerrado, registra alta severidad y no repara relaciones', async () => {
    const actor = await doctorFixture({ access: null, assignment: 'ACTIVE' });
    const other = await doctorFixture({ access: null, assignment: null });
    await prisma.professionalAccess.create({ data: {
      userId: actor.user.id, doctorProfileId: other.doctor.id, status: 'ACTIVE',
      source: 'ADMINISTRATIVE_REPAIR', activatedAt: new Date(),
    } });
    const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => undefined);

    await request(app).get('/api/doctors/me/profile').set('Authorization', `Bearer ${actor.token}`).expect(403)
      .expect(({ body }) => expect(body.code).toBe('PROFESSIONAL_PROFILE_INCONSISTENT'));
    expect(errorSpy).toHaveBeenCalledWith('[ProfessionalAuthEnforcement]', expect.objectContaining({
      userId: actor.user.id, code: 'PROFESSIONAL_PROFILE_INCONSISTENT',
    }));
    expect(await prisma.professionalAccess.findUniqueOrThrow({ where: { userId: actor.user.id } })).toMatchObject({ doctorProfileId: other.doctor.id });
    errorSpy.mockRestore();
  });

  it('callbacks OAuth iniciados antes de suspensión vuelven a validar DOCTOR antes de intercambiar tokens', async () => {
    const actor = await doctorFixture({ access: 'ACTIVE', assignment: 'ACTIVE' });
    const [googleAuth, outlookAuth] = await Promise.all([
      request(app).get('/api/calendar/google/auth').set('Authorization', `Bearer ${actor.token}`).expect(200),
      request(app).get('/api/calendar/outlook/auth').set('Authorization', `Bearer ${actor.token}`).expect(200),
    ]);
    const googleState = new URL(googleAuth.body.url).searchParams.get('state');
    const outlookState = new URL(outlookAuth.body.url).searchParams.get('state');
    expect(googleState).toBeTruthy();
    expect(outlookState).toBeTruthy();

    await prisma.professionalAccess.update({
      where: { userId: actor.user.id },
      data: { status: 'SUSPENDED', suspendedAt: new Date() },
    });

    await request(app).get('/api/calendar/google/callback').query({ code: 'never-exchanged', state: googleState })
      .expect(403).expect(({ body }) => expect(body.code).toBe('PROFESSIONAL_ACCESS_SUSPENDED'));
    await request(app).get('/api/calendar/outlook/callback').query({ code: 'never-exchanged', state: outlookState })
      .expect(403).expect(({ body }) => expect(body.code).toBe('PROFESSIONAL_ACCESS_SUSPENDED'));
    expect(await prisma.doctorProfile.findUniqueOrThrow({ where: { id: actor.doctor.id } })).toMatchObject({
      googleAccessToken: null,
      outlookAccessToken: null,
    });
  });

  it('roles no DOCTOR conservan guards mixtos y PATIENT no obtiene capacidad DOCTOR', async () => {
    const [clinic, assistant, admin, patient] = await Promise.all([
      roleFixture('CLINIC_ADMIN'), roleFixture('ASSISTANT'), roleFixture('SUPER_ADMIN'), roleFixture('PATIENT'),
    ]);
    const token = (user: typeof clinic) => `Bearer ${generateToken({ id: user.id, role: user.role })}`;

    await request(app).patch('/api/bookings/fake/status').set('Authorization', token(clinic)).send({}).expect(410);
    await request(app).patch('/api/bookings/fake/status').set('Authorization', token(admin)).send({}).expect(410);
    await request(app).patch('/api/bookings/fake/start').set('Authorization', token(assistant)).send({}).expect(404);
    await request(app).get('/api/doctors/me/profile').set('Authorization', token(patient)).expect(403);
  });
});
