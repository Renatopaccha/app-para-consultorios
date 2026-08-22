import type { PrismaClient, Role } from '../../generated/prisma';
import { resolveProfessionalAuthorization } from './professionalAuthorization.service';

type ProfessionalPortalClient = Pick<PrismaClient, 'user' | 'professionalApplication'>;

export type ProfessionalPortalResolution =
  | { allowed: true; action: 'DASHBOARD'; redirectTo: '/dashboard' }
  | { allowed: true; action: 'ONBOARDING_WIZARD'; redirectTo: '/registro-profesional' | `/registro-profesional/paso/${1 | 2 | 3 | 4}` | '/registro-profesional/revision' }
  | { allowed: true; action: 'ONBOARDING_STATUS'; redirectTo: '/registro-profesional/estado' }
  | { allowed: false; action: 'ACCESS_DENIED'; redirectTo: null; code: 'PROFESSIONAL_ACCESS_SUSPENDED' | 'PROFESSIONAL_ACCESS_REVOKED' };

function wizardRedirect(lastVisitedStep: number): ProfessionalPortalResolution {
  if (lastVisitedStep === 5) {
    return { allowed: true, action: 'ONBOARDING_WIZARD', redirectTo: '/registro-profesional/revision' };
  }
  if (lastVisitedStep >= 1 && lastVisitedStep <= 4) {
    return {
      allowed: true,
      action: 'ONBOARDING_WIZARD',
      redirectTo: `/registro-profesional/paso/${lastVisitedStep as 1 | 2 | 3 | 4}`,
    };
  }
  return { allowed: true, action: 'ONBOARDING_WIZARD', redirectTo: '/registro-profesional/paso/1' };
}

/**
 * Resolves navigation intent without weakening authorization on professional
 * APIs. Only a complete ACTIVE access decision reaches the real dashboard.
 */
export async function resolveProfessionalPortal(
  client: ProfessionalPortalClient,
  input: { userId: string; currentRole: Role },
): Promise<ProfessionalPortalResolution> {
  const authorization = await resolveProfessionalAuthorization(client, input);

  if (authorization.professionalAccessAllowed) {
    return { allowed: true, action: 'DASHBOARD', redirectTo: '/dashboard' };
  }

  if (authorization.professionalAccessStatus === 'SUSPENDED') {
    return { allowed: false, action: 'ACCESS_DENIED', redirectTo: null, code: 'PROFESSIONAL_ACCESS_SUSPENDED' };
  }
  if (authorization.professionalAccessStatus === 'REVOKED') {
    return { allowed: false, action: 'ACCESS_DENIED', redirectTo: null, code: 'PROFESSIONAL_ACCESS_REVOKED' };
  }

  const application = await client.professionalApplication.findFirst({
    where: { userId: input.userId },
    orderBy: [{ createdAt: 'desc' }, { cycleNumber: 'desc' }],
    select: { status: true, lastVisitedStep: true },
  });

  if (!application) {
    return { allowed: true, action: 'ONBOARDING_WIZARD', redirectTo: '/registro-profesional' };
  }
  if (application.status === 'DRAFT' || application.status === 'NEEDS_CHANGES') {
    return wizardRedirect(application.lastVisitedStep);
  }
  return { allowed: true, action: 'ONBOARDING_STATUS', redirectTo: '/registro-profesional/estado' };
}
