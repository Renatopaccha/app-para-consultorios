jest.mock('../prisma', () => ({
  __esModule: true,
  default: { user: { findUnique: jest.fn() } },
}));

import type { Request } from 'express';
import prisma from '../prisma';
import { authorizeProfessionalRequest, resetProfessionalAuthEnforcementRateLimitForTests } from './professionalAuthorizationEnforcement.service';
import { resetProfessionalAuthObservationRateLimitForTests } from './professionalAuthorizationShadow.service';

const findUnique = prisma.user.findUnique as jest.Mock;
const logger = { info: jest.fn(), error: jest.fn() };
const req = {
  method: 'GET', baseUrl: '/api/doctors', path: '/me/profile',
  header: jest.fn().mockReturnValue('request-enforcement-unit'),
} as unknown as Request;

function state(overrides: Record<string, unknown> = {}) {
  return {
    id: 'user-a',
    doctorProfile: { id: 'doctor-a' },
    roleAssignments: [{ revokedAt: null }],
    professionalAccess: {
      userId: 'user-a', doctorProfileId: 'doctor-a', status: 'ACTIVE',
      doctorProfile: { userId: 'user-a' },
    },
    ...overrides,
  };
}

describe('cutover de autorización profesional', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    resetProfessionalAuthEnforcementRateLimitForTests();
    resetProfessionalAuthObservationRateLimitForTests();
  });
  afterEach(() => delete process.env.PROFESSIONAL_AUTH_ENFORCEMENT_MODE);

  it('legacy permite sin consultar ProfessionalAccess', async () => {
    process.env.PROFESSIONAL_AUTH_ENFORCEMENT_MODE = 'legacy';
    await expect(authorizeProfessionalRequest({ req, userId: 'user-a', currentRole: 'DOCTOR', logger }))
      .resolves.toMatchObject({ allowed: true, mode: 'legacy', decision: null });
    expect(findUnique).not.toHaveBeenCalled();
  });

  it('shadow permite y observa sin convertir el resolver en decisión efectiva', async () => {
    process.env.PROFESSIONAL_AUTH_ENFORCEMENT_MODE = 'shadow';
    findUnique.mockResolvedValue(state({ professionalAccess: null }));
    await expect(authorizeProfessionalRequest({ req, userId: 'user-a', currentRole: 'DOCTOR', logger }))
      .resolves.toMatchObject({ allowed: true, mode: 'shadow', decision: null });
    await new Promise((resolve) => setImmediate(resolve));
    expect(findUnique).toHaveBeenCalledTimes(1);
  });

  it('enforce permite ACTIVE equivalente', async () => {
    process.env.PROFESSIONAL_AUTH_ENFORCEMENT_MODE = 'enforce';
    findUnique.mockResolvedValue(state());
    await expect(authorizeProfessionalRequest({ req, userId: 'user-a', currentRole: 'DOCTOR', logger }))
      .resolves.toMatchObject({ allowed: true, mode: 'enforce', decision: { professionalAccessAllowed: true } });
  });

  it.each([
    ['missing access', { professionalAccess: null }, 'PROFESSIONAL_ACCESS_REQUIRED'],
    ['missing assignment', { roleAssignments: [] }, 'PROFESSIONAL_ACCESS_REQUIRED'],
    ['revoked assignment', { roleAssignments: [{ revokedAt: new Date() }] }, 'PROFESSIONAL_ROLE_REVOKED'],
    ['suspended', { professionalAccess: { ...state().professionalAccess, status: 'SUSPENDED' } }, 'PROFESSIONAL_ACCESS_SUSPENDED'],
    ['revoked', { professionalAccess: { ...state().professionalAccess, status: 'REVOKED' } }, 'PROFESSIONAL_ACCESS_REVOKED'],
    ['mismatch', { professionalAccess: { ...state().professionalAccess, doctorProfileId: 'doctor-b', doctorProfile: { userId: 'user-b' } } }, 'PROFESSIONAL_PROFILE_INCONSISTENT'],
  ] as const)('enforce deniega %s con 403 y código público seguro', async (_label, overrides, code) => {
    process.env.PROFESSIONAL_AUTH_ENFORCEMENT_MODE = 'enforce';
    findUnique.mockResolvedValue(state(overrides));
    await expect(authorizeProfessionalRequest({ req, userId: 'user-a', currentRole: 'DOCTOR', logger }))
      .resolves.toMatchObject({ allowed: false, mode: 'enforce', status: 403, code });
  });

  it('enforce falla cerrado con 503 si el resolver no está disponible', async () => {
    process.env.PROFESSIONAL_AUTH_ENFORCEMENT_MODE = 'enforce';
    findUnique.mockRejectedValue(new Error('database unavailable with secret detail'));
    await expect(authorizeProfessionalRequest({ req, userId: 'user-a', currentRole: 'DOCTOR', logger }))
      .resolves.toMatchObject({
        allowed: false, status: 503, code: 'PROFESSIONAL_AUTHORIZATION_UNAVAILABLE', decision: null,
      });
    expect(JSON.stringify(logger.error.mock.calls)).not.toContain('database unavailable with secret detail');
  });
});
