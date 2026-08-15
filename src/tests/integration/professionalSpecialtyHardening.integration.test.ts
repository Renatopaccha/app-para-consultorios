import prisma, { disconnectPrisma } from '../../prisma';
import { assertIntegrationDatabase, clearIntegrationDatabase } from './testDatabase';

async function expectUniqueViolation(operation: Promise<unknown>) {
  await expect(operation).rejects.toMatchObject({ code: 'P2002' });
}

describe('hardening del catálogo Specialty', () => {
  beforeEach(async () => {
    assertIntegrationDatabase();
    await clearIntegrationDatabase();
  });

  afterAll(async () => {
    await clearIntegrationDatabase();
    await disconnectPrisma();
  });

  it.each([
    ['healthProfessionId', `INSERT INTO "Specialty" (id, name, code, "nameNormalized", "createdAt", "updatedAt") VALUES ('missing-profession', 'Test', 'TEST', 'test', NOW(), NOW())`],
    ['code', `INSERT INTO "Specialty" (id, name, "nameNormalized", "healthProfessionId", "createdAt", "updatedAt") VALUES ('missing-code', 'Test', 'test', $1, NOW(), NOW())`],
    ['nameNormalized', `INSERT INTO "Specialty" (id, name, code, "healthProfessionId", "createdAt", "updatedAt") VALUES ('missing-normalized', 'Test', 'TEST', $1, NOW(), NOW())`],
  ])('rechaza una Specialty sin %s', async (_field, sql) => {
    const profession = await prisma.healthProfession.create({
      data: { code: 'REQUIRED_TEST', name: 'Required test', nameNormalized: 'required test' },
    });
    const operation = sql.includes('$1')
      ? prisma.$executeRawUnsafe(sql, profession.id)
      : prisma.$executeRawUnsafe(sql);
    await expect(operation).rejects.toThrow();
  });

  it('impide code y nameNormalized duplicados dentro de la misma profesión', async () => {
    const profession = await prisma.healthProfession.create({
      data: { code: 'SAME_PROFESSION', name: 'Misma profesión', nameNormalized: 'misma profesion' },
    });
    await prisma.specialty.create({
      data: {
        healthProfessionId: profession.id, code: 'SHARED_CODE', name: 'Primera',
        nameNormalized: 'primera',
      },
    });
    await expectUniqueViolation(prisma.specialty.create({
      data: {
        healthProfessionId: profession.id, code: 'SHARED_CODE', name: 'Segunda',
        nameNormalized: 'segunda',
      },
    }));
    await expectUniqueViolation(prisma.specialty.create({
      data: {
        healthProfessionId: profession.id, code: 'OTHER_CODE', name: 'Primera alternativa',
        nameNormalized: 'primera',
      },
    }));
  });

  it('permite el mismo name y nameNormalized en profesiones diferentes', async () => {
    const [firstProfession, secondProfession] = await Promise.all([
      prisma.healthProfession.create({ data: { code: 'PROFESSION_A', name: 'Profesión A', nameNormalized: 'profesion a' } }),
      prisma.healthProfession.create({ data: { code: 'PROFESSION_B', name: 'Profesión B', nameNormalized: 'profesion b' } }),
    ]);
    const first = await prisma.specialty.create({
      data: {
        healthProfessionId: firstProfession.id, code: 'SHARED',
        name: 'Especialidad compartida', nameNormalized: 'especialidad compartida',
      },
    });
    const second = await prisma.specialty.create({
      data: {
        healthProfessionId: secondProfession.id, code: 'SHARED',
        name: 'Especialidad compartida', nameNormalized: 'especialidad compartida',
      },
    });
    expect(second.id).not.toBe(first.id);
  });
});
