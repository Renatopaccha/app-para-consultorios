import prisma from '../../prisma';
import {
  applyLegacyProfessionalAccessBackfill,
  planLegacyProfessionalAccessBackfill,
  ProfessionalAccessBackfillConflictError,
} from '../../services/professionalAccessBackfill.service';
import { assertIntegrationDatabase, clearIntegrationDatabase } from './testDatabase';

let sequence = 0;

async function createLegacyDoctor(
  verificationStatus: 'APPROVED' | 'PENDING' | 'REJECTED' | 'SUSPENDED',
  options: { userId?: string; doctorProfileId?: string; role?: 'DOCTOR' | 'PATIENT'; isVerified?: boolean } = {},
) {
  sequence += 1;
  const suffix = `${sequence}-${verificationStatus.toLowerCase()}`;
  const user = await prisma.user.create({
    data: {
      id: options.userId,
      firstName: 'Legacy',
      lastName: 'Doctor',
      email: `legacy-${suffix}@example.test`,
      emailNormalized: `legacy-${suffix}@example.test`,
      role: options.role ?? 'DOCTOR',
    },
  });
  const doctor = await prisma.doctorProfile.create({
    data: {
      id: options.doctorProfileId,
      userId: user.id,
      licenseNumber: `LEGACY-${suffix}`,
      consultationPrice: 50,
      verificationStatus,
      isVerified: options.isVerified ?? verificationStatus === 'APPROVED',
    },
  });
  return { user, doctor };
}

describe('professional_access_compatibility y backfill legacy', () => {
  beforeAll(() => assertIntegrationDatabase());
  beforeEach(async () => {
    await clearIntegrationDatabase();
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it('APPROVED crea ACTIVE, assignment y audit sin cambiar IDs ni relaciones legacy', async () => {
    const { user, doctor } = await createLegacyDoctor('APPROVED');

    const plan = await planLegacyProfessionalAccessBackfill(prisma);
    expect(plan.proposed).toMatchObject({
      professionalAccessCreates: 1,
      roleAssignmentCreates: 1,
      auditLogCreates: 1,
    });
    expect(plan.anomalies).toEqual([]);

    await applyLegacyProfessionalAccessBackfill(prisma);

    const access = await prisma.professionalAccess.findUniqueOrThrow({ where: { userId: user.id } });
    expect(access).toMatchObject({
      userId: user.id,
      doctorProfileId: doctor.id,
      status: 'ACTIVE',
      source: 'LEGACY_BACKFILL',
    });
    expect(await prisma.userRoleAssignment.findUnique({
      where: { userId_role_scopeKey: { userId: user.id, role: 'DOCTOR', scopeKey: 'GLOBAL' } },
    })).toMatchObject({ source: 'LEGACY_BACKFILL', revokedAt: null });
    expect(await prisma.professionalAccessAuditLog.count({
      where: { accessId: access.id, action: 'ACTIVATED', newStatus: 'ACTIVE' },
    })).toBe(1);
    expect(await prisma.user.findUniqueOrThrow({ where: { id: user.id } })).toMatchObject({ id: user.id, role: 'DOCTOR' });
    expect(await prisma.doctorProfile.findUniqueOrThrow({ where: { id: doctor.id } })).toMatchObject({
      id: doctor.id,
      userId: user.id,
      verificationStatus: 'APPROVED',
    });
  });

  it('la segunda ejecución es no-op y no modifica updatedAt', async () => {
    const { user } = await createLegacyDoctor('APPROVED');
    await applyLegacyProfessionalAccessBackfill(prisma);
    const beforeAccess = await prisma.professionalAccess.findUniqueOrThrow({ where: { userId: user.id } });
    const beforeAssignment = await prisma.userRoleAssignment.findUniqueOrThrow({
      where: { userId_role_scopeKey: { userId: user.id, role: 'DOCTOR', scopeKey: 'GLOBAL' } },
    });

    const second = await applyLegacyProfessionalAccessBackfill(prisma);

    expect(second.proposed).toMatchObject({
      professionalAccessCreates: 0,
      roleAssignmentCreates: 0,
      auditLogCreates: 0,
      approvedAlreadyEquivalent: 1,
    });
    expect(await prisma.professionalAccess.findUniqueOrThrow({ where: { userId: user.id } })).toMatchObject({
      updatedAt: beforeAccess.updatedAt,
    });
    expect(await prisma.userRoleAssignment.findUniqueOrThrow({
      where: { userId_role_scopeKey: { userId: user.id, role: 'DOCTOR', scopeKey: 'GLOBAL' } },
    })).toMatchObject({ updatedAt: beforeAssignment.updatedAt });
    expect(await prisma.professionalAccessAuditLog.count()).toBe(1);
  });

  it.each(['PENDING', 'REJECTED'] as const)('%s no recibe ACTIVE ni role assignment', async (status) => {
    await createLegacyDoctor(status);
    const plan = await planLegacyProfessionalAccessBackfill(prisma);

    expect(plan.skippedForReview[status.toLowerCase() as 'pending' | 'rejected']).toBe(1);
    await applyLegacyProfessionalAccessBackfill(prisma);
    expect(await prisma.professionalAccess.count()).toBe(0);
    expect(await prisma.userRoleAssignment.count()).toBe(0);
  });

  it('SUSPENDED se reporta para revisión y no se escribe automáticamente', async () => {
    await createLegacyDoctor('SUSPENDED');
    const plan = await applyLegacyProfessionalAccessBackfill(prisma);

    expect(plan.skippedForReview.suspended).toBe(1);
    expect(await prisma.professionalAccess.count()).toBe(0);
    expect(await prisma.userRoleAssignment.count()).toBe(0);
  });

  it('reporta anomalías y aborta sin reparar DoctorProfile/User divergentes', async () => {
    const { user } = await createLegacyDoctor('APPROVED', { role: 'PATIENT', isVerified: false });
    const plan = await planLegacyProfessionalAccessBackfill(prisma);

    expect(plan.anomalies.map(({ code }) => code)).toEqual(expect.arrayContaining([
      'PROFILE_USER_NOT_DOCTOR',
      'VERIFICATION_STATE_DIVERGENCE',
    ]));
    await expect(applyLegacyProfessionalAccessBackfill(prisma)).rejects.toBeInstanceOf(
      ProfessionalAccessBackfillConflictError,
    );
    expect(await prisma.professionalAccess.count()).toBe(0);
    expect((await prisma.user.findUniqueOrThrow({ where: { id: user.id } })).role).toBe('PATIENT');
  });

  it('hace rollback completo si falla una escritura después de iniciar el APPLY', async () => {
    const first = await createLegacyDoctor('APPROVED', { userId: 'a-user', doctorProfileId: 'a-profile' });
    const existing = await createLegacyDoctor('APPROVED', { userId: 'z-user', doctorProfileId: 'z-profile' });
    const existingAccess = await prisma.professionalAccess.create({
      data: {
        userId: existing.user.id,
        doctorProfileId: existing.doctor.id,
        status: 'ACTIVE',
        source: 'APPLICATION_APPROVAL',
        activatedAt: new Date(),
      },
    });
    await prisma.professionalAccessAuditLog.create({
      data: {
        accessId: existingAccess.id,
        action: 'ACTIVATED',
        newStatus: 'ACTIVE',
        idempotencyKey: 'professional-access:legacy-backfill:a-profile:activated',
      },
    });

    await expect(applyLegacyProfessionalAccessBackfill(prisma)).rejects.toMatchObject({ code: 'P2002' });
    expect(await prisma.professionalAccess.findUnique({ where: { userId: first.user.id } })).toBeNull();
    expect(await prisma.userRoleAssignment.findUnique({
      where: { userId_role_scopeKey: { userId: first.user.id, role: 'DOCTOR', scopeKey: 'GLOBAL' } },
    })).toBeNull();
    expect(await prisma.professionalAccess.count()).toBe(1);
  });

  it('impone uniques por User, DoctorProfile y role/scope', async () => {
    const first = await createLegacyDoctor('APPROVED');
    const second = await createLegacyDoctor('APPROVED');
    await prisma.professionalAccess.create({
      data: {
        userId: first.user.id,
        doctorProfileId: first.doctor.id,
        status: 'ACTIVE',
        source: 'LEGACY_BACKFILL',
        activatedAt: new Date(),
      },
    });

    await expect(prisma.professionalAccess.create({
      data: {
        userId: first.user.id,
        doctorProfileId: second.doctor.id,
        status: 'ACTIVE',
        source: 'LEGACY_BACKFILL',
        activatedAt: new Date(),
      },
    })).rejects.toMatchObject({ code: 'P2002' });
    await expect(prisma.professionalAccess.create({
      data: {
        userId: second.user.id,
        doctorProfileId: first.doctor.id,
        status: 'ACTIVE',
        source: 'LEGACY_BACKFILL',
        activatedAt: new Date(),
      },
    })).rejects.toMatchObject({ code: 'P2002' });

    await prisma.userRoleAssignment.create({
      data: { userId: first.user.id, role: 'DOCTOR', scopeKey: 'GLOBAL', source: 'LEGACY_BACKFILL' },
    });
    await expect(prisma.userRoleAssignment.create({
      data: { userId: first.user.id, role: 'DOCTOR', scopeKey: 'GLOBAL', source: 'ADMINISTRATIVE' },
    })).rejects.toMatchObject({ code: 'P2002' });
  });

  it('una suspensión futura no modifica Application APPROVED ni su snapshot histórico', async () => {
    const { user, doctor } = await createLegacyDoctor('APPROVED');
    const application = await prisma.professionalApplication.create({
      data: {
        userId: user.id,
        cycleNumber: 1,
        status: 'APPROVED',
        submittedAt: new Date('2026-08-01T00:00:00Z'),
        decidedAt: new Date('2026-08-02T00:00:00Z'),
      },
    });
    const snapshot = await prisma.professionalApplicationSnapshot.create({
      data: {
        applicationId: application.id,
        revision: 1,
        schemaVersion: 1,
        payload: { approved: true },
        payloadHash: 'a'.repeat(64),
      },
    });
    const access = await prisma.professionalAccess.create({
      data: {
        userId: user.id,
        doctorProfileId: doctor.id,
        approvedSnapshotId: snapshot.id,
        status: 'ACTIVE',
        source: 'APPLICATION_APPROVAL',
        activatedAt: new Date(),
      },
    });

    await prisma.professionalAccess.update({
      where: { id: access.id },
      data: { status: 'SUSPENDED', suspendedAt: new Date(), reasonCode: 'ADMIN_REVIEW', version: { increment: 1 } },
    });

    expect(await prisma.professionalApplication.findUniqueOrThrow({ where: { id: application.id } })).toMatchObject({
      status: 'APPROVED',
      decidedAt: application.decidedAt,
    });
    expect(await prisma.professionalApplicationSnapshot.findUniqueOrThrow({ where: { id: snapshot.id } })).toMatchObject({
      payloadHash: 'a'.repeat(64),
    });
    expect(await prisma.user.findUniqueOrThrow({ where: { id: user.id } })).toMatchObject({ role: 'DOCTOR' });
  });
});
