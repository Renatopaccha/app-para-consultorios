import { resolveProfessionalAuthorization } from './professionalAuthorization.service';

const findUnique = jest.fn();
const client = { user: { findUnique } } as never;

function state(overrides: Record<string, unknown> = {}) {
  return {
    id: 'user-a',
    doctorProfile: { id: 'doctor-a' },
    roleAssignments: [{ revokedAt: null }],
    professionalAccess: {
      userId: 'user-a',
      doctorProfileId: 'doctor-a',
      status: 'ACTIVE',
      doctorProfile: { userId: 'user-a' },
    },
    ...overrides,
  };
}

describe('ProfessionalAuthorizationResolver', () => {
  beforeEach(() => jest.clearAllMocks());

  it('resuelve ACTIVE como equivalente y mantiene effectiveAllowed=legacy', async () => {
    findUnique.mockResolvedValue(state());
    await expect(resolveProfessionalAuthorization(client, {
      userId: 'user-a', currentRole: 'DOCTOR',
    })).resolves.toEqual(expect.objectContaining({
      legacyAllowed: true,
      professionalAccessAllowed: true,
      effectiveAllowed: true,
      equivalent: true,
      roleAssignmentPresent: true,
      professionalAccessStatus: 'ACTIVE',
      doctorProfileMatch: true,
      reasonCode: null,
      discrepancyCode: null,
    }));
  });

  it.each([
    ['missing access', { professionalAccess: null }, 'MISSING_PROFESSIONAL_ACCESS'],
    ['suspended', { professionalAccess: { ...state().professionalAccess, status: 'SUSPENDED' } }, 'ACCESS_NOT_ACTIVE'],
    ['revoked', { professionalAccess: { ...state().professionalAccess, status: 'REVOKED' } }, 'ACCESS_NOT_ACTIVE'],
    ['missing assignment', { roleAssignments: [] }, 'MISSING_ROLE_ASSIGNMENT'],
    ['revoked assignment', { roleAssignments: [{ revokedAt: new Date() }] }, 'ROLE_ASSIGNMENT_REVOKED'],
  ] as const)('deniega newAllowed para %s y expone códigos estructurados', async (_label, overrides, reasonCode) => {
    findUnique.mockResolvedValue(state(overrides));
    await expect(resolveProfessionalAuthorization(client, {
      userId: 'user-a', currentRole: 'DOCTOR',
    })).resolves.toEqual(expect.objectContaining({
      legacyAllowed: true,
      professionalAccessAllowed: false,
      effectiveAllowed: true,
      equivalent: false,
      reasonCode,
      discrepancyCode: 'LEGACY_ALLOW_NEW_DENY',
    }));
  });

  it('detecta que el DoctorProfile de ProfessionalAccess pertenece a otro User', async () => {
    findUnique.mockResolvedValue(state({
      professionalAccess: {
        ...state().professionalAccess,
        doctorProfileId: 'doctor-b',
        doctorProfile: { userId: 'user-b' },
      },
    }));
    await expect(resolveProfessionalAuthorization(client, {
      userId: 'user-a', currentRole: 'DOCTOR',
    })).resolves.toEqual(expect.objectContaining({
      professionalAccessAllowed: false,
      doctorProfileMatch: false,
      reasonCode: 'PROFILE_USER_MISMATCH',
      discrepancyCode: 'LEGACY_ALLOW_NEW_DENY',
    }));
  });

  it('detecta LEGACY_DENY_NEW_ALLOW sin convertirlo en autorización efectiva', async () => {
    findUnique.mockResolvedValue(state());
    await expect(resolveProfessionalAuthorization(client, {
      userId: 'user-a', currentRole: 'PATIENT',
    })).resolves.toEqual(expect.objectContaining({
      legacyAllowed: false,
      professionalAccessAllowed: true,
      effectiveAllowed: false,
      discrepancyCode: 'LEGACY_DENY_NEW_ALLOW',
    }));
  });
});
