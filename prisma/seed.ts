import bcrypt from 'bcrypt';
import prisma from '../src/prisma';
import { normalizeEmail } from '../src/services/emailIdentity.service';

type DevelopmentSeedConfig = {
  superAdminEmail: string;
  superAdminPassword: string;
  clinicAdminEmail: string;
  clinicAdminPassword: string;
  doctorEmail: string;
  doctorPassword: string;
  doctorLicenseNumber: string;
};

const required = (name: string, value: string | undefined): string => {
  const normalized = value?.trim();
  if (!normalized) throw new Error(`${name} es obligatoria para ejecutar el seed de desarrollo.`);
  return normalized;
};

function getDevelopmentSeedConfig(env: NodeJS.ProcessEnv): DevelopmentSeedConfig {
  return {
    superAdminEmail: normalizeEmail(required('DEV_SUPER_ADMIN_EMAIL', env.DEV_SUPER_ADMIN_EMAIL)),
    superAdminPassword: required('DEV_SUPER_ADMIN_PASSWORD', env.DEV_SUPER_ADMIN_PASSWORD),
    clinicAdminEmail: normalizeEmail(required('DEV_CLINIC_ADMIN_EMAIL', env.DEV_CLINIC_ADMIN_EMAIL)),
    clinicAdminPassword: required('DEV_CLINIC_ADMIN_PASSWORD', env.DEV_CLINIC_ADMIN_PASSWORD),
    doctorEmail: normalizeEmail(required('DEV_DOCTOR_EMAIL', env.DEV_DOCTOR_EMAIL)),
    doctorPassword: required('DEV_DOCTOR_PASSWORD', env.DEV_DOCTOR_PASSWORD),
    doctorLicenseNumber: required('DEV_DOCTOR_LICENSE_NUMBER', env.DEV_DOCTOR_LICENSE_NUMBER),
  };
}

function assertSafeSeedEnvironment(env: NodeJS.ProcessEnv) {
  if (env.NODE_ENV === 'production') throw new Error('El seed de desarrollo está bloqueado en producción.');
}

async function passwordHash(password: string, variable: string): Promise<string> {
  if (password.length < 12) throw new Error(`${variable} debe tener al menos 12 caracteres.`);
  return bcrypt.hash(password, 12);
}

async function ensureCatalogs() {
  const specialtyNames = ['Medicina General', 'Cardiología'];
  const insuranceNames = ['Privado / Particular', 'IESS'];
  const specialties = await Promise.all(specialtyNames.map((name) => prisma.specialty.upsert({ where: { name }, update: {}, create: { name } })));
  const insurances = await Promise.all(insuranceNames.map((name) => prisma.insurance.upsert({ where: { name }, update: {}, create: { name } })));
  return { specialties, insurances };
}

export async function seedDevelopmentData(env: NodeJS.ProcessEnv = process.env) {
  assertSafeSeedEnvironment(env);
  const config = getDevelopmentSeedConfig(env);
  const [superAdminHash, clinicAdminHash, doctorHash] = await Promise.all([
    passwordHash(config.superAdminPassword, 'DEV_SUPER_ADMIN_PASSWORD'),
    passwordHash(config.clinicAdminPassword, 'DEV_CLINIC_ADMIN_PASSWORD'),
    passwordHash(config.doctorPassword, 'DEV_DOCTOR_PASSWORD'),
  ]);
  const { specialties, insurances } = await ensureCatalogs();

  const superAdmin = await prisma.user.upsert({
    where: { emailNormalized: config.superAdminEmail },
    update: { emailNormalized: config.superAdminEmail, passwordHash: superAdminHash, role: 'SUPER_ADMIN' },
    create: { email: config.superAdminEmail, emailNormalized: config.superAdminEmail, passwordHash: superAdminHash, firstName: 'Admin', lastName: 'Desarrollo', role: 'SUPER_ADMIN' },
  });
  const clinicAdmin = await prisma.user.upsert({
    where: { emailNormalized: config.clinicAdminEmail },
    update: { emailNormalized: config.clinicAdminEmail, passwordHash: clinicAdminHash, role: 'CLINIC_ADMIN' },
    create: { email: config.clinicAdminEmail, emailNormalized: config.clinicAdminEmail, passwordHash: clinicAdminHash, firstName: 'Clínica', lastName: 'Desarrollo', role: 'CLINIC_ADMIN' },
  });
  const clinic = await prisma.clinicProfile.upsert({
    where: { userId: clinicAdmin.id },
    update: { name: 'Clínica Zenda Desarrollo', address: 'Dirección de desarrollo', verificationStatus: 'APPROVED', verifiedAt: new Date(), specialties: { set: specialties.map(({ id }) => ({ id })) }, insurances: { set: insurances.map(({ id }) => ({ id })) } },
    create: { userId: clinicAdmin.id, name: 'Clínica Zenda Desarrollo', address: 'Dirección de desarrollo', verificationStatus: 'APPROVED', verifiedAt: new Date(), specialties: { connect: specialties.map(({ id }) => ({ id })) }, insurances: { connect: insurances.map(({ id }) => ({ id })) } },
  });
  const doctorUser = await prisma.user.upsert({
    where: { emailNormalized: config.doctorEmail },
    update: { email: config.doctorEmail, emailNormalized: config.doctorEmail, passwordHash: doctorHash, role: 'DOCTOR' },
    create: { email: config.doctorEmail, emailNormalized: config.doctorEmail, passwordHash: doctorHash, firstName: 'Doctor', lastName: 'Desarrollo', role: 'DOCTOR' },
  });
  const doctor = await prisma.doctorProfile.upsert({
    where: { userId: doctorUser.id },
    update: { licenseNumber: config.doctorLicenseNumber, consultationPrice: 45, isVerified: true, verificationStatus: 'APPROVED', verifiedAt: new Date(), isIndependent: true, professionCode: 'MEDICINE', displayTitle: 'DR', customDisplayTitle: null, bio: 'Perfil médico creado exclusivamente para desarrollo.', languages: ['Español'], specialties: { set: specialties.map(({ id }) => ({ id })) }, insurances: { set: insurances.map(({ id }) => ({ id })) } },
    create: { userId: doctorUser.id, licenseNumber: config.doctorLicenseNumber, consultationPrice: 45, isVerified: true, verificationStatus: 'APPROVED', verifiedAt: new Date(), isIndependent: true, professionCode: 'MEDICINE', displayTitle: 'DR', bio: 'Perfil médico creado exclusivamente para desarrollo.', languages: ['Español'], specialties: { connect: specialties.map(({ id }) => ({ id })) }, insurances: { connect: insurances.map(({ id }) => ({ id })) } },
  });
  const independentOffice = await prisma.clinicProfile.upsert({
    where: { userId: doctorUser.id },
    update: { name: 'Consultorio privado', address: 'Dirección por configurar', type: 'INDEPENDENT_PRACTICE', verificationStatus: 'APPROVED', verifiedAt: new Date() },
    create: { userId: doctorUser.id, name: 'Consultorio privado', address: 'Dirección por configurar', type: 'INDEPENDENT_PRACTICE', verificationStatus: 'APPROVED', verifiedAt: new Date() },
  });
  await prisma.doctorClinicWorkplace.upsert({ where: { doctorProfileId_clinicProfileId: { doctorProfileId: doctor.id, clinicProfileId: clinic.id } }, update: { isActive: true, leftAt: null }, create: { doctorProfileId: doctor.id, clinicProfileId: clinic.id, isActive: true } });
  await prisma.doctorClinicWorkplace.upsert({ where: { doctorProfileId_clinicProfileId: { doctorProfileId: doctor.id, clinicProfileId: independentOffice.id } }, update: { isActive: true, leftAt: null }, create: { doctorProfileId: doctor.id, clinicProfileId: independentOffice.id, isActive: true } });

  const serviceDefinitions = [
    { name: 'Consulta de desarrollo', description: 'Servicio de prueba para validar el panel médico.', priceCents: 4500, duration: 30 },
    { name: 'Consulta de seguimiento', description: 'Servicio de prueba de seguimiento.', priceCents: 3000, duration: 20 },
  ];
  for (const service of serviceDefinitions) {
    const existing = await prisma.service.findFirst({ where: { doctorProfileId: doctor.id, name: service.name }, select: { id: true } });
    const data = { description: service.description, priceCents: service.priceCents, price: service.priceCents / 100, currency: 'USD' as const, duration: service.duration, isActive: true, clinicProfileId: clinic.id, doctorProfileId: doctor.id };
    if (existing) await prisma.service.update({ where: { id: existing.id }, data });
    else await prisma.service.create({ data: { name: service.name, ...data } });
  }
  return { superAdmin, clinic, doctorUser, doctor };
}

async function main() {
  console.log('🌱 Preparando datos de desarrollo de Zenda...');
  await seedDevelopmentData();
  console.log('✅ Superadministrador, clínica, doctor, catálogos y servicios de desarrollo preparados.');
}

if (require.main === module) {
  main().catch((error) => { console.error('❌ Error en la siembra:', error); process.exitCode = 1; }).finally(async () => { await prisma.$disconnect(); });
}
