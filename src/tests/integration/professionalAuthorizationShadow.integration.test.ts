import request from 'supertest';
import app from '../../app';
import prisma, { disconnectPrisma } from '../../prisma';
import { resolveProfessionalAuthorization } from '../../services/professionalAuthorization.service';
import { resetProfessionalAuthObservationRateLimitForTests } from '../../services/professionalAuthorizationShadow.service';
import { generateToken } from '../../utils/jwt';
import { assertIntegrationDatabase, clearIntegrationDatabase } from './testDatabase';

let sequence = 0;

async function createDoctorFixture(input: {
  verificationStatus?: 'PENDING' | 'APPROVED' | 'REJECTED' | 'SUSPENDED';
  accessStatus?: 'ACTIVE' | 'SUSPENDED' | 'REVOKED' | null;
  assignment?: 'ACTIVE' | 'REVOKED' | null;
  applicationStatus?: 'PENDING_REVIEW' | 'APPROVED';
} = {}) {
  sequence += 1;
  const suffix = `shadow-${sequence}`;
  const user = await prisma.user.create({
    data: {
      firstName: 'Shadow', lastName: 'Doctor',
      email: `${suffix}@example.test`, emailNormalized: `${suffix}@example.test`, role: 'DOCTOR',
    },
  });
  const doctor = await prisma.doctorProfile.create({
    data: {
      userId: user.id,
      licenseNumber: `SHADOW-${sequence}`,
      consultationPrice: 50,
      verificationStatus: input.verificationStatus ?? 'APPROVED',
      isVerified: (input.verificationStatus ?? 'APPROVED') === 'APPROVED',
    },
  });
  if (input.applicationStatus) {
    await prisma.professionalApplication.create({
      data: {
        userId: user.id,
        cycleNumber: 1,
        status: input.applicationStatus,
        submittedAt: new Date(),
        ...(input.applicationStatus === 'APPROVED' ? { decidedAt: new Date() } : {}),
      },
    });
  }
  if (input.assignment !== null) {
    const assignedAt = new Date(Date.now() - 1_000);
    await prisma.userRoleAssignment.create({
      data: {
        userId: user.id, role: 'DOCTOR', scopeKey: 'GLOBAL', source: 'LEGACY_BACKFILL',
        assignedAt,
        ...(input.assignment === 'REVOKED' ? { revokedAt: new Date() } : {}),
      },
    });
  }
  if (input.accessStatus !== null) {
    const status = input.accessStatus ?? 'ACTIVE';
    await prisma.professionalAccess.create({
      data: {
        userId: user.id,
        doctorProfileId: doctor.id,
        status,
        source: 'LEGACY_BACKFILL',
        activatedAt: new Date(),
        ...(status === 'SUSPENDED' ? { suspendedAt: new Date() } : {}),
        ...(status === 'REVOKED' ? { revokedAt: new Date() } : {}),
      },
    });
  }
  return { user, doctor, token: generateToken({ id: user.id, role: 'DOCTOR' }) };
}

describe('shadow authorization profesional con PostgreSQL real', () => {
  beforeAll(() => assertIntegrationDatabase());
  beforeEach(async () => {
    process.env.PROFESSIONAL_AUTH_ENFORCEMENT_MODE = 'shadow';
    resetProfessionalAuthObservationRateLimitForTests();
    await clearIntegrationDatabase();
  });
  afterAll(async () => {
    delete process.env.PROFESSIONAL_AUTH_ENFORCEMENT_MODE;
    await clearIntegrationDatabase();
    await disconnectPrisma();
  });

  it('doctor ACTIVE/DOCTOR-GLOBAL mantiene allow/allow en rutas principales', async () => {
    const actor = await createDoctorFixture({ accessStatus: 'ACTIVE', assignment: 'ACTIVE' });
    const infoSpy = jest.spyOn(console, 'info').mockImplementation(() => undefined);

    const responses = await Promise.all([
      '/api/doctors/me/dashboard-summary',
      '/api/doctors/me/workspaces',
      '/api/doctors/me/profile',
      '/api/doctors/me/services',
      '/api/doctors/me/work-schedules',
      '/api/doctors/me/reviews',
      '/api/doctors/me/certifications',
      '/api/clinics/my-clinics',
    ].map((path) => request(app).get(path).set('Authorization', `Bearer ${actor.token}`)));

    expect(responses.map(({ status }) => status)).toEqual(Array(8).fill(200));
    await expect(resolveProfessionalAuthorization(prisma, {
      userId: actor.user.id, currentRole: 'DOCTOR',
    })).resolves.toEqual(expect.objectContaining({
      legacyAllowed: true, professionalAccessAllowed: true, effectiveAllowed: true, equivalent: true,
    }));
    expect(infoSpy).not.toHaveBeenCalledWith('[ProfessionalAuthShadow]', expect.anything());
    infoSpy.mockRestore();
  });

  it('PENDING_REVIEW conserva shadow en APIs pero el portal dirige al estado de onboarding', async () => {
    const actor = await createDoctorFixture({
      verificationStatus: 'PENDING', applicationStatus: 'PENDING_REVIEW', accessStatus: null, assignment: null,
    });
    const infoSpy = jest.spyOn(console, 'info').mockImplementation(() => undefined);

    await request(app).get('/api/doctors/me/profile')
      .set('Authorization', `Bearer ${actor.token}`).set('x-request-id', 'pending-shadow-request').expect(200);
    const portal = await request(app).post('/api/auth/resolve-portal')
      .set('Authorization', `Bearer ${actor.token}`).send({ portal: 'professional' }).expect(200);
    await new Promise((resolve) => setImmediate(resolve));

    expect(portal.body).toEqual({ portal: 'professional', allowed: true, action: 'ONBOARDING_STATUS', redirectTo: '/registro-profesional/estado' });
    await expect(resolveProfessionalAuthorization(prisma, {
      userId: actor.user.id, currentRole: 'DOCTOR',
    })).resolves.toEqual(expect.objectContaining({
      legacyAllowed: true,
      professionalAccessAllowed: false,
      effectiveAllowed: true,
      reasonCode: 'MISSING_ROLE_ASSIGNMENT',
      discrepancyCode: 'LEGACY_ALLOW_NEW_DENY',
    }));
    expect(infoSpy).toHaveBeenCalledWith('[ProfessionalAuthShadow]', expect.objectContaining({
      requestId: 'pending-shadow-request',
      userId: actor.user.id,
      legacyAllowed: true,
      newAllowed: false,
      discrepancyCode: 'LEGACY_ALLOW_NEW_DENY',
      reasonCode: 'MISSING_ROLE_ASSIGNMENT',
    }));
    infoSpy.mockRestore();
  });

  it.each(['SUSPENDED', 'REVOKED'] as const)('%s mantiene HTTP legacy 200 pero newAllowed=false', async (status) => {
    const actor = await createDoctorFixture({ accessStatus: status, assignment: 'ACTIVE' });

    await request(app).get('/api/doctors/me/profile').set('Authorization', `Bearer ${actor.token}`).expect(200);
    await expect(resolveProfessionalAuthorization(prisma, {
      userId: actor.user.id, currentRole: 'DOCTOR',
    })).resolves.toEqual(expect.objectContaining({
      legacyAllowed: true,
      professionalAccessAllowed: false,
      effectiveAllowed: true,
      professionalAccessStatus: status,
      reasonCode: 'ACCESS_NOT_ACTIVE',
    }));
  });

  it('assignment revocado mantiene HTTP legacy pero newAllowed=false', async () => {
    const actor = await createDoctorFixture({ accessStatus: 'ACTIVE', assignment: 'REVOKED' });

    await request(app).get('/api/doctors/me/profile').set('Authorization', `Bearer ${actor.token}`).expect(200);
    await expect(resolveProfessionalAuthorization(prisma, {
      userId: actor.user.id, currentRole: 'DOCTOR',
    })).resolves.toEqual(expect.objectContaining({
      professionalAccessAllowed: false,
      effectiveAllowed: true,
      roleAssignmentRevoked: true,
      reasonCode: 'ROLE_ASSIGNMENT_REVOKED',
    }));
  });

  it('profile mismatch es discrepancia crítica, no se repara y no cambia HTTP legacy', async () => {
    const actor = await createDoctorFixture({ accessStatus: null, assignment: 'ACTIVE' });
    const other = await createDoctorFixture({ accessStatus: null, assignment: null });
    await prisma.professionalAccess.create({
      data: {
        userId: actor.user.id,
        doctorProfileId: other.doctor.id,
        status: 'ACTIVE',
        source: 'ADMINISTRATIVE_REPAIR',
        activatedAt: new Date(),
      },
    });

    await request(app).get('/api/doctors/me/profile').set('Authorization', `Bearer ${actor.token}`).expect(200);
    await expect(resolveProfessionalAuthorization(prisma, {
      userId: actor.user.id, currentRole: 'DOCTOR',
    })).resolves.toEqual(expect.objectContaining({
      professionalAccessAllowed: false,
      effectiveAllowed: true,
      doctorProfileMatch: false,
      reasonCode: 'PROFILE_USER_MISMATCH',
    }));
    expect(await prisma.professionalAccess.findUniqueOrThrow({ where: { userId: actor.user.id } })).toMatchObject({
      doctorProfileId: other.doctor.id,
    });
  });
});
