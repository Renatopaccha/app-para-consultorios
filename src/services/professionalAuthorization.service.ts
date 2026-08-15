import type { PrismaClient, Role } from '../../generated/prisma';

type ProfessionalAuthorizationClient = Pick<PrismaClient, 'user'>;

export type ProfessionalAuthorizationReasonCode =
  | 'USER_NOT_FOUND'
  | 'MISSING_ROLE_ASSIGNMENT'
  | 'ROLE_ASSIGNMENT_REVOKED'
  | 'MISSING_PROFESSIONAL_ACCESS'
  | 'ACCESS_NOT_ACTIVE'
  | 'MISSING_DOCTOR_PROFILE'
  | 'PROFILE_USER_MISMATCH';

export type ProfessionalAuthorizationDiscrepancyCode =
  | 'LEGACY_ALLOW_NEW_DENY'
  | 'LEGACY_DENY_NEW_ALLOW';

export interface ProfessionalAuthorizationDecision {
  legacyAllowed: boolean;
  professionalAccessAllowed: boolean;
  effectiveAllowed: boolean;
  equivalent: boolean;
  roleAssignmentPresent: boolean;
  roleAssignmentRevoked: boolean;
  professionalAccessStatus: 'ACTIVE' | 'SUSPENDED' | 'REVOKED' | null;
  doctorProfileMatch: boolean;
  reasonCode: ProfessionalAuthorizationReasonCode | null;
  discrepancyCode: ProfessionalAuthorizationDiscrepancyCode | null;
}

export async function resolveProfessionalAuthorization(
  client: ProfessionalAuthorizationClient,
  input: { userId: string; currentRole: Role; doctorProfileId?: string | null },
): Promise<ProfessionalAuthorizationDecision> {
  const legacyAllowed = input.currentRole === 'DOCTOR';
  const user = await client.user.findUnique({
    where: { id: input.userId },
    select: {
      id: true,
      doctorProfile: { select: { id: true } },
      roleAssignments: {
        where: { role: 'DOCTOR', scopeKey: 'GLOBAL' },
        select: { revokedAt: true },
        take: 1,
      },
      professionalAccess: {
        select: {
          userId: true,
          doctorProfileId: true,
          status: true,
          doctorProfile: { select: { userId: true } },
        },
      },
    },
  });

  const assignment = user?.roleAssignments[0];
  const access = user?.professionalAccess;
  const expectedProfileId = input.doctorProfileId ?? user?.doctorProfile?.id ?? null;
  const roleAssignmentPresent = Boolean(assignment);
  const roleAssignmentRevoked = Boolean(assignment?.revokedAt);
  const doctorProfileMatch = Boolean(
    user
    && expectedProfileId
    && user.doctorProfile?.id === expectedProfileId
    && access?.userId === user.id
    && access.doctorProfileId === expectedProfileId
    && access.doctorProfile.userId === user.id,
  );

  let reasonCode: ProfessionalAuthorizationReasonCode | null = null;
  if (!user) reasonCode = 'USER_NOT_FOUND';
  else if (!assignment) reasonCode = 'MISSING_ROLE_ASSIGNMENT';
  else if (assignment.revokedAt) reasonCode = 'ROLE_ASSIGNMENT_REVOKED';
  else if (!access) reasonCode = 'MISSING_PROFESSIONAL_ACCESS';
  else if (access.status !== 'ACTIVE') reasonCode = 'ACCESS_NOT_ACTIVE';
  else if (!expectedProfileId || !user.doctorProfile) reasonCode = 'MISSING_DOCTOR_PROFILE';
  else if (!doctorProfileMatch) reasonCode = 'PROFILE_USER_MISMATCH';

  const professionalAccessAllowed = reasonCode === null;
  const discrepancyCode: ProfessionalAuthorizationDiscrepancyCode | null =
    legacyAllowed === professionalAccessAllowed
      ? null
      : legacyAllowed
        ? 'LEGACY_ALLOW_NEW_DENY'
        : 'LEGACY_DENY_NEW_ALLOW';

  return {
    legacyAllowed,
    professionalAccessAllowed,
    // Shadow phase invariant: the effective professional decision is legacy.
    effectiveAllowed: legacyAllowed,
    equivalent: discrepancyCode === null,
    roleAssignmentPresent,
    roleAssignmentRevoked,
    professionalAccessStatus: access?.status ?? null,
    doctorProfileMatch,
    reasonCode,
    discrepancyCode,
  };
}
