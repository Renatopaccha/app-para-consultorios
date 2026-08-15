import prisma, { disconnectPrisma } from '../../prisma';
import {
  applyProfessionalCatalogImport,
  planProfessionalCatalogImport,
  ProfessionalCatalogConflictError,
} from '../../catalogs/professionalCatalog.service';
import { assertIntegrationDatabase, clearIntegrationDatabase } from './testDatabase';

const context = { environment: 'test', databaseName: 'zenda_test' };

async function createLegacySpecialtyGraph() {
  const doctorUser = await prisma.user.create({
    data: {
      email: 'catalog-import-doctor@zenda.test', emailNormalized: 'catalog-import-doctor@zenda.test',
      firstName: 'Catalog', lastName: 'Doctor', role: 'DOCTOR',
    },
  });
  const clinicUser = await prisma.user.create({
    data: {
      email: 'catalog-import-clinic@zenda.test', emailNormalized: 'catalog-import-clinic@zenda.test',
      firstName: 'Catalog', lastName: 'Clinic', role: 'CLINIC_ADMIN',
    },
  });
  const profession = await prisma.healthProfession.create({
    data: { code: 'MEDICINE', name: 'Medicina', nameNormalized: 'medicina', sortOrder: 10 },
  });
  const medicine = await prisma.specialty.create({
    data: {
      name: 'Medicina General', code: 'MEDICINE_GENERAL', nameNormalized: 'medicina general',
      healthProfessionId: profession.id,
    },
  });
  const cardiology = await prisma.specialty.create({
    data: {
      name: 'Cardiología', code: 'CARDIOLOGY', nameNormalized: 'cardiologia',
      healthProfessionId: profession.id,
    },
  });
  const doctor = await prisma.doctorProfile.create({
    data: {
      userId: doctorUser.id, licenseNumber: 'CATALOG-IMPORT-TEST', consultationPrice: 50,
      specialties: { connect: [{ id: medicine.id }, { id: cardiology.id }] },
    },
  });
  await prisma.clinicProfile.create({
    data: {
      userId: clinicUser.id, name: 'Catalog Test Clinic', address: 'Test address',
      specialties: { connect: [{ id: medicine.id }, { id: cardiology.id }] },
    },
  });
  return { doctor, medicine, cardiology };
}

describe('importador versionado de catálogos profesionales', () => {
  beforeEach(async () => {
    assertIntegrationDatabase();
    await clearIntegrationDatabase();
  });

  afterAll(async () => {
    await clearIntegrationDatabase();
    await disconnectPrisma();
  });

  it('dry-run informa acciones y no escribe', async () => {
    await createLegacySpecialtyGraph();
    const before = {
      professions: await prisma.healthProfession.count(),
      languages: await prisma.language.count(),
      specialties: await prisma.specialty.findMany({ orderBy: { id: 'asc' } }),
    };
    const plan = await planProfessionalCatalogImport(prisma, context);
    const after = {
      professions: await prisma.healthProfession.count(),
      languages: await prisma.language.count(),
      specialties: await prisma.specialty.findMany({ orderBy: { id: 'asc' } }),
    };

    expect(plan).toMatchObject({
      mode: 'DRY_RUN', prerequisites: { ready: true }, conflicts: [],
      summary: { creates: 9, updates: 0, unchanged: 3, pendingDecisions: 2, unmappedSpecialties: 0 },
    });
    expect(after).toEqual(before);
  });

  it('importa de forma idempotente y conserva IDs y relaciones legacy', async () => {
    const legacy = await createLegacySpecialtyGraph();
    const originalIds = [legacy.medicine.id, legacy.cardiology.id].sort();

    await applyProfessionalCatalogImport(prisma, context);
    const firstIds = {
      professions: await prisma.healthProfession.findMany({ orderBy: { code: 'asc' } }),
      languages: await prisma.language.findMany({ orderBy: { code: 'asc' } }),
      specialties: await prisma.specialty.findMany({ orderBy: { id: 'asc' } }),
    };
    await applyProfessionalCatalogImport(prisma, context);
    const secondIds = {
      professions: await prisma.healthProfession.findMany({ orderBy: { code: 'asc' } }),
      languages: await prisma.language.findMany({ orderBy: { code: 'asc' } }),
      specialties: await prisma.specialty.findMany({ orderBy: { id: 'asc' } }),
    };

    expect(secondIds).toEqual(firstIds);
    expect(await prisma.healthProfession.count()).toBe(3);
    expect(await prisma.language.count()).toBe(7);
    expect(await prisma.registrationAuthority.count()).toBe(0);
    expect(await prisma.institution.count()).toBe(0);
    const specialties = await prisma.specialty.findMany({
      include: { healthProfession: true }, orderBy: { id: 'asc' },
    });
    expect(specialties.map(({ id }) => id)).toEqual(originalIds);
    expect(specialties.map(({ code }) => code).sort()).toEqual(['CARDIOLOGY', 'MEDICINE_GENERAL']);
    expect(specialties.every(({ healthProfession }) => healthProfession?.code === 'MEDICINE')).toBe(true);
    const doctorAfter = await prisma.doctorProfile.findUniqueOrThrow({
      where: { id: legacy.doctor.id }, include: { specialties: { orderBy: { id: 'asc' } } },
    });
    expect(doctorAfter.specialties.map(({ id }) => id)).toEqual(originalIds);
  });

  it('reporta Specialty desconocida sin adivinar ni crear reemplazos', async () => {
    const profession = await prisma.healthProfession.create({
      data: { code: 'TEST_OTHER', name: 'Otra profesión', nameNormalized: 'otra profesion' },
    });
    const unknown = await prisma.specialty.create({
      data: {
        name: 'Especialidad por decidir', code: 'REQUIRES_REVIEW',
        nameNormalized: 'especialidad por decidir', healthProfessionId: profession.id,
      },
    });
    const plan = await planProfessionalCatalogImport(prisma, context);
    expect(plan.specialtyAudit).toContainEqual(expect.objectContaining({
      id: unknown.id, status: 'UNMAPPED_REQUIRES_REVIEW', proposedCode: null,
    }));
    await applyProfessionalCatalogImport(prisma, context);
    expect(await prisma.specialty.findUniqueOrThrow({ where: { id: unknown.id } })).toMatchObject({
      name: 'Especialidad por decidir', healthProfessionId: profession.id,
      code: 'REQUIRES_REVIEW', nameNormalized: 'especialidad por decidir',
    });
    expect(await prisma.specialty.count()).toBe(1);
  });

  it('un conflicto aborta la transacción con diagnóstico y sin escrituras parciales', async () => {
    const conflicting = await prisma.healthProfession.create({
      data: { code: 'DENTISTRY', name: 'Registro conflictivo', nameNormalized: 'medicina' },
    });
    const before = {
      professions: await prisma.healthProfession.findMany(),
      languages: await prisma.language.count(),
      specialties: await prisma.specialty.findMany({ orderBy: { id: 'asc' } }),
    };

    await expect(applyProfessionalCatalogImport(prisma, context)).rejects.toBeInstanceOf(ProfessionalCatalogConflictError);
    const plan = await planProfessionalCatalogImport(prisma, context);
    expect(plan.conflicts).toContain('HealthProfession MEDICINE: normalizedName "medicina" pertenece a otro ID.');
    expect(await prisma.healthProfession.findUniqueOrThrow({ where: { id: conflicting.id } })).toEqual(before.professions[0]);
    expect(await prisma.language.count()).toBe(before.languages);
    expect(await prisma.specialty.findMany({ orderBy: { id: 'asc' } })).toEqual(before.specialties);
  });
});
