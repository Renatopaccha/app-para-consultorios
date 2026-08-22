import { resolveProfessionalPortal } from './professionalPortalResolution.service';

const userFindUnique = jest.fn();
const applicationFindFirst = jest.fn();
const client = {
  user: { findUnique: userFindUnique },
  professionalApplication: { findFirst: applicationFindFirst },
} as never;

function authorizationState(input: {
  access?: 'ACTIVE' | 'SUSPENDED' | 'REVOKED' | null;
  assignment?: boolean;
  doctorProfile?: boolean;
} = {}) {
  const hasProfile = input.doctorProfile ?? false;
  const access = input.access ?? null;
  return {
    id: 'user-portal',
    doctorProfile: hasProfile ? { id: 'doctor-portal' } : null,
    roleAssignments: input.assignment ? [{ revokedAt: null }] : [],
    professionalAccess: access ? {
      userId: 'user-portal',
      doctorProfileId: 'doctor-portal',
      status: access,
      doctorProfile: { userId: 'user-portal' },
    } : null,
  };
}

describe('professional portal navigation resolution', () => {
  beforeEach(() => jest.clearAllMocks());

  it('routes a PATIENT without an application to onboarding instead of denying access', async () => {
    userFindUnique.mockResolvedValue(authorizationState());
    applicationFindFirst.mockResolvedValue(null);

    await expect(resolveProfessionalPortal(client, { userId: 'user-portal', currentRole: 'PATIENT' }))
      .resolves.toEqual({ allowed: true, action: 'ONBOARDING_WIZARD', redirectTo: '/registro-profesional' });
  });

  it('routes a PATIENT DRAFT to its last visited wizard step', async () => {
    userFindUnique.mockResolvedValue(authorizationState());
    applicationFindFirst.mockResolvedValue({ status: 'DRAFT', lastVisitedStep: 3 });

    await expect(resolveProfessionalPortal(client, { userId: 'user-portal', currentRole: 'PATIENT' }))
      .resolves.toEqual({ allowed: true, action: 'ONBOARDING_WIZARD', redirectTo: '/registro-profesional/paso/3' });
  });

  it('uses the existing review route for wizard step 5', async () => {
    userFindUnique.mockResolvedValue(authorizationState());
    applicationFindFirst.mockResolvedValue({ status: 'NEEDS_CHANGES', lastVisitedStep: 5 });

    await expect(resolveProfessionalPortal(client, { userId: 'user-portal', currentRole: 'PATIENT' }))
      .resolves.toEqual({ allowed: true, action: 'ONBOARDING_WIZARD', redirectTo: '/registro-profesional/revision' });
  });

  it('routes a PATIENT PENDING_REVIEW to application status', async () => {
    userFindUnique.mockResolvedValue(authorizationState());
    applicationFindFirst.mockResolvedValue({ status: 'PENDING_REVIEW', lastVisitedStep: 5 });

    await expect(resolveProfessionalPortal(client, { userId: 'user-portal', currentRole: 'PATIENT' }))
      .resolves.toEqual({ allowed: true, action: 'ONBOARDING_STATUS', redirectTo: '/registro-profesional/estado' });
  });

  it('routes only a fully ACTIVE DOCTOR authorization to the dashboard', async () => {
    userFindUnique.mockResolvedValue(authorizationState({ access: 'ACTIVE', assignment: true, doctorProfile: true }));

    await expect(resolveProfessionalPortal(client, { userId: 'user-portal', currentRole: 'DOCTOR' }))
      .resolves.toEqual({ allowed: true, action: 'DASHBOARD', redirectTo: '/dashboard' });
    expect(applicationFindFirst).not.toHaveBeenCalled();
  });

  it.each(['SUSPENDED', 'REVOKED'] as const)('keeps %s as a real access denial', async (status) => {
    userFindUnique.mockResolvedValue(authorizationState({ access: status, assignment: true, doctorProfile: true }));

    await expect(resolveProfessionalPortal(client, { userId: 'user-portal', currentRole: 'DOCTOR' }))
      .resolves.toEqual({
        allowed: false,
        action: 'ACCESS_DENIED',
        redirectTo: null,
        code: `PROFESSIONAL_ACCESS_${status}`,
      });
    expect(applicationFindFirst).not.toHaveBeenCalled();
  });
});
