import bcrypt from 'bcrypt';
import prisma, { disconnectPrisma } from '../../prisma';
import { clearIntegrationDatabase, assertIntegrationDatabase } from './testDatabase';

const { seedDevelopmentData } = require('../../../prisma/seed') as {
  seedDevelopmentData: (environment: NodeJS.ProcessEnv) => Promise<unknown>;
};

const environment: NodeJS.ProcessEnv = {
  ...process.env,
  NODE_ENV: 'test',
  DEV_SUPER_ADMIN_EMAIL: 'seed.admin@zenda.test',
  DEV_SUPER_ADMIN_PASSWORD: 'seed-admin-password-123',
  DEV_CLINIC_ADMIN_EMAIL: 'seed.clinic@zenda.test',
  DEV_CLINIC_ADMIN_PASSWORD: 'seed-clinic-password-123',
  DEV_DOCTOR_EMAIL: 'seed.doctor@zenda.test',
  DEV_DOCTOR_PASSWORD: 'seed-doctor-password-123',
  DEV_DOCTOR_LICENSE_NUMBER: 'SEED-DOCTOR-001',
};

describe('seed de desarrollo idempotente', () => {
  beforeEach(async () => { assertIntegrationDatabase(); await clearIntegrationDatabase(); });
  afterAll(async () => { await clearIntegrationDatabase(); await disconnectPrisma(); });

  it('puede ejecutarse dos veces sin duplicar el médico, vínculo ni servicios', async () => {
    await prisma.healthProfession.create({
      data: { code: 'MEDICINE', name: 'Medicina', nameNormalized: 'medicina' },
    });
    await seedDevelopmentData(environment);
    await seedDevelopmentData(environment);
    const doctorUser = await prisma.user.findUnique({ where: { email: environment.DEV_DOCTOR_EMAIL }, include: { doctorProfile: { include: { workplaces: true, services: true } } } });
    expect(doctorUser?.role).toBe('DOCTOR');
    expect(await bcrypt.compare(environment.DEV_DOCTOR_PASSWORD!, doctorUser?.passwordHash ?? '')).toBe(true);
    expect(doctorUser?.doctorProfile).toBeTruthy();
    expect(doctorUser?.doctorProfile?.workplaces).toHaveLength(2);
    expect(doctorUser?.doctorProfile?.workplaces.every((workplace) => workplace.isActive)).toBe(true);
    expect(doctorUser?.doctorProfile?.services).toHaveLength(2);
    expect(doctorUser?.doctorProfile?.services.every((service) => typeof service.priceCents === 'number' && service.priceCents > 0)).toBe(true);
    expect(await prisma.user.count({ where: { email: environment.DEV_DOCTOR_EMAIL } })).toBe(1);
  });

  it('rechaza explícitamente producción antes de crear registros', async () => {
    await expect(seedDevelopmentData({ ...environment, NODE_ENV: 'production' })).rejects.toThrow('bloqueado en producción');
    expect(await prisma.user.count()).toBe(0);
  });
});
