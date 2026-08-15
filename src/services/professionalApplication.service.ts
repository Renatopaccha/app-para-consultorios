import type { PrismaClient } from '../../generated/prisma';

export class ProfessionalApplicationInvariantError extends Error {
  constructor(public readonly code: 'APPLICATION_PROFESSION_REQUIRED' | 'SPECIALTY_PROFESSION_MISMATCH' | 'CREDENTIAL_OWNER_MISMATCH' | 'CREDENTIAL_DELETED') {
    super(code);
  }
}

export async function attachProfessionalApplicationSpecialty(
  prisma: PrismaClient,
  input: { applicationId: string; specialtyId: string; isPrimary?: boolean },
) {
  return prisma.$transaction(async (tx) => {
    const [application, specialty] = await Promise.all([
      tx.professionalApplication.findUniqueOrThrow({
        where: { id: input.applicationId },
        select: { healthProfessionId: true },
      }),
      tx.specialty.findUniqueOrThrow({
        where: { id: input.specialtyId },
        select: { healthProfessionId: true },
      }),
    ]);
    if (!application.healthProfessionId) {
      throw new ProfessionalApplicationInvariantError('APPLICATION_PROFESSION_REQUIRED');
    }
    if (application.healthProfessionId !== specialty.healthProfessionId) {
      throw new ProfessionalApplicationInvariantError('SPECIALTY_PROFESSION_MISMATCH');
    }
    return tx.professionalApplicationSpecialty.create({
      data: {
        applicationId: input.applicationId,
        specialtyId: input.specialtyId,
        isPrimary: input.isPrimary ?? false,
      },
    });
  });
}

export async function attachProfessionalApplicationCredential(
  prisma: PrismaClient,
  input: { applicationId: string; credentialId: string; isPrimary?: boolean; sortOrder?: number },
) {
  return prisma.$transaction(async (tx) => {
    const [application, credential] = await Promise.all([
      tx.professionalApplication.findUniqueOrThrow({
        where: { id: input.applicationId },
        select: { userId: true },
      }),
      tx.professionalCredential.findUniqueOrThrow({
        where: { id: input.credentialId },
        select: { userId: true, deletedAt: true },
      }),
    ]);
    if (application.userId !== credential.userId) {
      throw new ProfessionalApplicationInvariantError('CREDENTIAL_OWNER_MISMATCH');
    }
    if (credential.deletedAt) {
      throw new ProfessionalApplicationInvariantError('CREDENTIAL_DELETED');
    }
    return tx.professionalApplicationCredential.create({
      data: {
        applicationId: input.applicationId,
        credentialId: input.credentialId,
        isPrimary: input.isPrimary ?? false,
        sortOrder: input.sortOrder ?? 0,
      },
    });
  });
}
