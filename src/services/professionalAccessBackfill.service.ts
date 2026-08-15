import type { Prisma, PrismaClient, Role, VerificationStatus } from '../../generated/prisma';

const GLOBAL_SCOPE = 'GLOBAL';
const LEGACY_AUDIT_PREFIX = 'professional-access:legacy-backfill:';

type BackfillClient = PrismaClient | Prisma.TransactionClient;

export type LegacyBackfillAnomalyCode =
  | 'DOCTOR_WITHOUT_PROFILE'
  | 'PROFILE_USER_NOT_DOCTOR'
  | 'VERIFICATION_STATE_DIVERGENCE'
  | 'ACCESS_USER_PROFILE_CONFLICT'
  | 'ACCESS_STATUS_CONFLICT'
  | 'ROLE_ASSIGNMENT_REVOKED'
  | 'LEGACY_ACCESS_AUDIT_MISSING';

export interface LegacyBackfillAnomaly {
  code: LegacyBackfillAnomalyCode;
  userId: string;
  doctorProfileId?: string;
  detail: string;
}

interface LegacyBackfillOperation {
  userId: string;
  doctorProfileId: string;
  createAccess: boolean;
  createRoleAssignment: boolean;
  createAuditLog: boolean;
}

export interface LegacyProfessionalAccessBackfillPlan {
  mode: 'PLAN';
  compatibilitySchemaReady: boolean;
  legacy: {
    approved: number;
    pending: number;
    rejected: number;
    suspended: number;
    doctorWithoutProfile: number;
    profileUserNotDoctor: number;
    verificationStateDivergence: number;
  };
  proposed: {
    professionalAccessCreates: number;
    roleAssignmentCreates: number;
    auditLogCreates: number;
    approvedAlreadyEquivalent: number;
  };
  skippedForReview: {
    pending: number;
    rejected: number;
    suspended: number;
  };
  anomalies: LegacyBackfillAnomaly[];
  operations: LegacyBackfillOperation[];
}

export class ProfessionalAccessBackfillConflictError extends Error {
  constructor(public readonly plan: LegacyProfessionalAccessBackfillPlan) {
    super('El backfill fue abortado porque existen anomalías o conflictos legacy.');
  }
}

export class ProfessionalAccessSchemaNotReadyError extends Error {
  constructor() {
    super('La Migración 4 no está aplicada: PLAN fue calculado en modo pre-DDL y APPLY no está disponible.');
  }
}

function verificationBucket(status: VerificationStatus): 'approved' | 'pending' | 'rejected' | 'suspended' {
  return status.toLowerCase() as 'approved' | 'pending' | 'rejected' | 'suspended';
}

function hasVerificationDivergence(isVerified: boolean, status: VerificationStatus): boolean {
  return isVerified !== (status === 'APPROVED');
}

function emptyPlan(compatibilitySchemaReady: boolean): LegacyProfessionalAccessBackfillPlan {
  return {
    mode: 'PLAN',
    compatibilitySchemaReady,
    legacy: {
      approved: 0,
      pending: 0,
      rejected: 0,
      suspended: 0,
      doctorWithoutProfile: 0,
      profileUserNotDoctor: 0,
      verificationStateDivergence: 0,
    },
    proposed: {
      professionalAccessCreates: 0,
      roleAssignmentCreates: 0,
      auditLogCreates: 0,
      approvedAlreadyEquivalent: 0,
    },
    skippedForReview: { pending: 0, rejected: 0, suspended: 0 },
    anomalies: [],
    operations: [],
  };
}

async function compatibilitySchemaExists(client: BackfillClient): Promise<boolean> {
  const rows = await client.$queryRawUnsafe<Array<{ ready: boolean }>>(
    `SELECT to_regclass('public."ProfessionalAccess"') IS NOT NULL
      AND to_regclass('public."UserRoleAssignment"') IS NOT NULL AS ready`,
  );
  return rows[0]?.ready === true;
}

async function planBeforeCompatibilitySchema(
  client: BackfillClient,
): Promise<LegacyProfessionalAccessBackfillPlan> {
  const users = await client.user.findMany({
    where: { OR: [{ role: 'DOCTOR' }, { doctorProfile: { isNot: null } }] },
    select: {
      id: true,
      role: true,
      doctorProfile: {
        select: { id: true, isVerified: true, verificationStatus: true },
      },
    },
    orderBy: { id: 'asc' },
  });
  const plan = emptyPlan(false);

  for (const user of users) {
    const profile = user.doctorProfile;
    if (!profile) {
      plan.legacy.doctorWithoutProfile += 1;
      plan.anomalies.push({
        code: 'DOCTOR_WITHOUT_PROFILE',
        userId: user.id,
        detail: 'El User tiene role=DOCTOR pero no tiene DoctorProfile.',
      });
      continue;
    }
    const bucket = verificationBucket(profile.verificationStatus);
    plan.legacy[bucket] += 1;
    if (user.role !== 'DOCTOR') {
      plan.legacy.profileUserNotDoctor += 1;
      plan.anomalies.push({
        code: 'PROFILE_USER_NOT_DOCTOR', userId: user.id, doctorProfileId: profile.id,
        detail: `El DoctorProfile pertenece a un User con role=${user.role}.`,
      });
    }
    if (hasVerificationDivergence(profile.isVerified, profile.verificationStatus)) {
      plan.legacy.verificationStateDivergence += 1;
      plan.anomalies.push({
        code: 'VERIFICATION_STATE_DIVERGENCE', userId: user.id, doctorProfileId: profile.id,
        detail: `isVerified=${profile.isVerified} contradice verificationStatus=${profile.verificationStatus}.`,
      });
    }
    if (profile.verificationStatus === 'APPROVED' && user.role === 'DOCTOR') {
      plan.operations.push({
        userId: user.id, doctorProfileId: profile.id,
        createAccess: true, createRoleAssignment: true, createAuditLog: true,
      });
      plan.proposed.professionalAccessCreates += 1;
      plan.proposed.roleAssignmentCreates += 1;
      plan.proposed.auditLogCreates += 1;
    } else if (profile.verificationStatus !== 'APPROVED') {
      plan.skippedForReview[bucket as 'pending' | 'rejected' | 'suspended'] += 1;
    }
  }
  return plan;
}

export async function planLegacyProfessionalAccessBackfill(
  client: BackfillClient,
): Promise<LegacyProfessionalAccessBackfillPlan> {
  if (!(await compatibilitySchemaExists(client))) {
    return planBeforeCompatibilitySchema(client);
  }
  const users = await client.user.findMany({
    where: {
      OR: [{ role: 'DOCTOR' }, { doctorProfile: { isNot: null } }],
    },
    select: {
      id: true,
      role: true,
      doctorProfile: {
        select: {
          id: true,
          isVerified: true,
          verificationStatus: true,
          professionalAccess: {
            select: {
              id: true,
              userId: true,
              doctorProfileId: true,
              status: true,
              source: true,
              auditLogs: {
                where: { idempotencyKey: { startsWith: LEGACY_AUDIT_PREFIX } },
                select: { id: true },
              },
            },
          },
        },
      },
      professionalAccess: {
        select: { id: true, userId: true, doctorProfileId: true, status: true, source: true },
      },
      roleAssignments: {
        where: { role: 'DOCTOR', scopeKey: GLOBAL_SCOPE },
        select: { id: true, source: true, sourceId: true, revokedAt: true },
      },
    },
    orderBy: { id: 'asc' },
  });

  const plan = emptyPlan(true);

  for (const user of users) {
    const profile = user.doctorProfile;
    if (!profile) {
      plan.legacy.doctorWithoutProfile += 1;
      plan.anomalies.push({
        code: 'DOCTOR_WITHOUT_PROFILE',
        userId: user.id,
        detail: 'El User tiene role=DOCTOR pero no tiene DoctorProfile.',
      });
      continue;
    }

    const bucket = verificationBucket(profile.verificationStatus);
    plan.legacy[bucket] += 1;

    if ((user.role as Role) !== 'DOCTOR') {
      plan.legacy.profileUserNotDoctor += 1;
      plan.anomalies.push({
        code: 'PROFILE_USER_NOT_DOCTOR',
        userId: user.id,
        doctorProfileId: profile.id,
        detail: `El DoctorProfile pertenece a un User con role=${user.role}.`,
      });
    }

    if (hasVerificationDivergence(profile.isVerified, profile.verificationStatus)) {
      plan.legacy.verificationStateDivergence += 1;
      plan.anomalies.push({
        code: 'VERIFICATION_STATE_DIVERGENCE',
        userId: user.id,
        doctorProfileId: profile.id,
        detail: `isVerified=${profile.isVerified} contradice verificationStatus=${profile.verificationStatus}.`,
      });
    }

    const userAccess = user.professionalAccess;
    const profileAccess = profile.professionalAccess;
    const access = userAccess ?? profileAccess;
    if (
      (userAccess && userAccess.doctorProfileId !== profile.id)
      || (profileAccess && profileAccess.userId !== user.id)
      || (userAccess && profileAccess && userAccess.id !== profileAccess.id)
    ) {
      plan.anomalies.push({
        code: 'ACCESS_USER_PROFILE_CONFLICT',
        userId: user.id,
        doctorProfileId: profile.id,
        detail: 'ProfessionalAccess existente no corresponde al par User/DoctorProfile legacy.',
      });
    }

    if (profile.verificationStatus !== 'APPROVED' || user.role !== 'DOCTOR') {
      if (profile.verificationStatus !== 'APPROVED') {
        plan.skippedForReview[bucket as 'pending' | 'rejected' | 'suspended'] += 1;
      }
      if (access?.status === 'ACTIVE') {
        plan.anomalies.push({
          code: 'ACCESS_STATUS_CONFLICT',
          userId: user.id,
          doctorProfileId: profile.id,
          detail: `ProfessionalAccess=ACTIVE contradice verificationStatus=${profile.verificationStatus}.`,
        });
      }
      continue;
    }

    if (access && access.status !== 'ACTIVE') {
      plan.anomalies.push({
        code: 'ACCESS_STATUS_CONFLICT',
        userId: user.id,
        doctorProfileId: profile.id,
        detail: `El profesional APPROVED tiene ProfessionalAccess=${access.status}.`,
      });
    }

    const assignment = user.roleAssignments[0];
    if (assignment?.revokedAt) {
      plan.anomalies.push({
        code: 'ROLE_ASSIGNMENT_REVOKED',
        userId: user.id,
        doctorProfileId: profile.id,
        detail: 'La asignación DOCTOR/GLOBAL existente está revocada y no se reactivará automáticamente.',
      });
    }

    const createAccess = !access;
    const createRoleAssignment = !assignment;
    let createAuditLog = createAccess;
    if (access?.source === 'LEGACY_BACKFILL' && profileAccess?.auditLogs.length === 0) {
      createAuditLog = false;
      plan.anomalies.push({
        code: 'LEGACY_ACCESS_AUDIT_MISSING',
        userId: user.id,
        doctorProfileId: profile.id,
        detail: 'ProfessionalAccess LEGACY_BACKFILL existente no tiene su evento de activación idempotente.',
      });
    }

    plan.operations.push({
      userId: user.id,
      doctorProfileId: profile.id,
      createAccess,
      createRoleAssignment,
      createAuditLog,
    });
    plan.proposed.professionalAccessCreates += Number(createAccess);
    plan.proposed.roleAssignmentCreates += Number(createRoleAssignment);
    plan.proposed.auditLogCreates += Number(createAuditLog);
    plan.proposed.approvedAlreadyEquivalent += Number(!createAccess && !createRoleAssignment);
  }

  return plan;
}

export async function applyLegacyProfessionalAccessBackfill(
  prisma: PrismaClient,
): Promise<LegacyProfessionalAccessBackfillPlan> {
  return prisma.$transaction(
    async (tx) => {
      const plan = await planLegacyProfessionalAccessBackfill(tx);
      if (!plan.compatibilitySchemaReady) {
        throw new ProfessionalAccessSchemaNotReadyError();
      }
      if (plan.anomalies.length > 0) {
        throw new ProfessionalAccessBackfillConflictError(plan);
      }

      for (const operation of plan.operations) {
        let accessId: string | undefined;
        if (operation.createAccess) {
          const access = await tx.professionalAccess.create({
            data: {
              userId: operation.userId,
              doctorProfileId: operation.doctorProfileId,
              status: 'ACTIVE',
              source: 'LEGACY_BACKFILL',
              activatedAt: new Date(),
            },
            select: { id: true },
          });
          accessId = access.id;
        }

        if (operation.createRoleAssignment) {
          await tx.userRoleAssignment.create({
            data: {
              userId: operation.userId,
              role: 'DOCTOR',
              scopeKey: GLOBAL_SCOPE,
              source: 'LEGACY_BACKFILL',
            },
          });
        }

        if (operation.createAuditLog) {
          if (!accessId) {
            throw new Error('No se puede crear el audit log legacy sin un ProfessionalAccess nuevo.');
          }
          await tx.professionalAccessAuditLog.create({
            data: {
              accessId,
              action: 'ACTIVATED',
              newStatus: 'ACTIVE',
              reasonCode: 'LEGACY_APPROVED_BACKFILL',
              idempotencyKey: `${LEGACY_AUDIT_PREFIX}${operation.doctorProfileId}:activated`,
            },
          });
        }
      }

      return plan;
    },
    { isolationLevel: 'Serializable' },
  );
}
