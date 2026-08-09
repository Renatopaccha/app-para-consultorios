import prisma, { disconnectPrisma } from '../../prisma';
import { clearIntegrationDatabase, assertIntegrationDatabase } from './testDatabase';
import { DevelopmentDoctorEmailError, updateExistingDevelopmentDoctorEmail } from '../../services/developmentDoctorEmail.service';

const { seedDevelopmentData } = require('../../../prisma/seed') as {
  seedDevelopmentData: (environment: NodeJS.ProcessEnv) => Promise<unknown>;
};

const NEW_DOCTOR_EMAIL = 'doctor.real@development.test';
const seedEnvironment: NodeJS.ProcessEnv = {
  ...process.env,
  NODE_ENV: 'test',
  DEV_SUPER_ADMIN_EMAIL: 'email-update.admin@zenda.test',
  DEV_SUPER_ADMIN_PASSWORD: 'email-update-admin-password',
  DEV_CLINIC_ADMIN_EMAIL: 'email-update.clinic@zenda.test',
  DEV_CLINIC_ADMIN_PASSWORD: 'email-update-clinic-password',
  DEV_DOCTOR_EMAIL: NEW_DOCTOR_EMAIL,
  DEV_DOCTOR_PASSWORD: 'email-update-doctor-password',
  DEV_DOCTOR_LICENSE_NUMBER: 'DEV-EMAIL-DOCTOR-001',
};

async function createDevelopmentDoctorFixture() {
  const [doctorUser, clinicUser, patient] = await Promise.all([
    prisma.user.create({ data: { email: 'doctor@zenda.test', emailNormalized: 'doctor@zenda.test', firstName: 'Development', lastName: 'Doctor', passwordHash: 'preserved-hash', role: 'DOCTOR' } }),
    prisma.user.create({ data: { email: 'clinic@development.test', emailNormalized: 'clinic@development.test', firstName: 'Development', lastName: 'Clinic', passwordHash: 'x', role: 'CLINIC_ADMIN' } }),
    prisma.user.create({ data: { email: 'patient@development.test', emailNormalized: 'patient@development.test', firstName: 'Development', lastName: 'Patient', passwordHash: 'x', role: 'PATIENT' } }),
  ]);
  const doctor = await prisma.doctorProfile.create({ data: { userId: doctorUser.id, licenseNumber: 'DEV-EMAIL-DOCTOR-001', consultationPrice: 50 } });
  const clinic = await prisma.clinicProfile.create({ data: { userId: clinicUser.id, name: 'Development Clinic', address: 'Development' } });
  const workplace = await prisma.doctorClinicWorkplace.create({ data: { doctorProfileId: doctor.id, clinicProfileId: clinic.id } });
  await prisma.workSchedule.create({ data: { workplaceId: workplace.id, weekday: 1, startTime: '08:00', endTime: '12:00' } });
  const service = await prisma.service.create({ data: { name: 'Development service', price: 50, priceCents: 5000, duration: 30, doctorProfileId: doctor.id, clinicProfileId: clinic.id } });
  const appointment = await prisma.appointment.create({ data: { patientId: patient.id, doctorProfileId: doctor.id, clinicProfileId: clinic.id, serviceId: service.id, date: new Date('2099-01-01T13:00:00.000Z'), startTime: '08:00', endTime: '08:30', startsAt: new Date('2099-01-01T13:00:00.000Z'), endsAt: new Date('2099-01-01T13:30:00.000Z') } });
  await prisma.payment.create({ data: { appointmentId: appointment.id, method: 'CASH', amountCents: 5000, currency: 'USD', codeExpiresAt: new Date('2099-01-02T13:00:00.000Z') } });
  await prisma.review.create({ data: { appointmentId: appointment.id, patientId: patient.id, doctorProfileId: doctor.id, rating: 5 } });
  await prisma.certification.create({ data: { title: 'Development certification', institution: 'Zenda', doctorProfileId: doctor.id } });
  await prisma.scheduleBlock.create({ data: { doctorProfileId: doctor.id, clinicProfileId: clinic.id, startsAt: new Date('2099-01-03T13:00:00.000Z'), endsAt: new Date('2099-01-03T14:00:00.000Z'), createdByUserId: doctorUser.id } });
  await prisma.patientInvitation.create({ data: { email: 'invitee@development.test', emailNormalized: 'invitee@development.test', firstName: 'Invitee', lastName: 'Development', tokenHash: 'development-doctor-email-token', expiresAt: new Date('2099-02-01T13:00:00.000Z'), invitedByUserId: doctorUser.id, doctorProfileId: doctor.id, clinicProfileId: clinic.id } });
  return { doctorUser, doctor };
}

describe('actualización segura del correo del doctor de desarrollo', () => {
  beforeEach(async () => { assertIntegrationDatabase(); await clearIntegrationDatabase(); });
  afterAll(async () => { await clearIntegrationDatabase(); await disconnectPrisma(); });

  it('updates only email identity and preserves the existing doctor plus all principal relations', async () => {
    const fixture = await createDevelopmentDoctorFixture();
    const result = await updateExistingDevelopmentDoctorEmail(prisma, NEW_DOCTOR_EMAIL);
    const updated = await prisma.user.findUniqueOrThrow({ where: { id: fixture.doctorUser.id }, include: { doctorProfile: true } });

    expect(result).toMatchObject({ userId: fixture.doctorUser.id, doctorProfileId: fixture.doctor.id, previousEmail: 'doctor@zenda.test', newEmail: NEW_DOCTOR_EMAIL });
    expect(result.relationCounts).toEqual({ appointments: 1, payments: 1, services: 1, certifications: 1, reviews: 1, workplaces: 1, scheduleBlocks: 1, patientInvitations: 1 });
    expect(updated).toMatchObject({ id: fixture.doctorUser.id, email: NEW_DOCTOR_EMAIL, emailNormalized: NEW_DOCTOR_EMAIL, role: 'DOCTOR', passwordHash: 'preserved-hash', clerkUserId: null, doctorProfile: { id: fixture.doctor.id } });
    expect(await prisma.user.findUnique({ where: { emailNormalized: 'doctor@zenda.test' } })).toBeNull();
    expect(await prisma.user.count({ where: { role: 'DOCTOR' } })).toBe(1);
    expect(await prisma.doctorProfile.count()).toBe(1);
  });

  it.each([undefined, '', 'not-an-email'])('aborts without changing records when DEV_DOCTOR_EMAIL is invalid', async (email) => {
    const fixture = await createDevelopmentDoctorFixture();
    await expect(updateExistingDevelopmentDoctorEmail(prisma, email)).rejects.toBeInstanceOf(DevelopmentDoctorEmailError);
    expect(await prisma.user.findUniqueOrThrow({ where: { id: fixture.doctorUser.id } })).toMatchObject({ email: 'doctor@zenda.test', passwordHash: 'preserved-hash', clerkUserId: null });
    expect(await prisma.doctorProfile.findUniqueOrThrow({ where: { id: fixture.doctor.id } })).toMatchObject({ userId: fixture.doctorUser.id });
  });

  it('aborts on email collision without creating or modifying a doctor', async () => {
    const fixture = await createDevelopmentDoctorFixture();
    const other = await prisma.user.create({ data: { email: NEW_DOCTOR_EMAIL, emailNormalized: NEW_DOCTOR_EMAIL, firstName: 'Other', lastName: 'User', passwordHash: 'x', role: 'PATIENT' } });
    await expect(updateExistingDevelopmentDoctorEmail(prisma, NEW_DOCTOR_EMAIL)).rejects.toThrow('ya pertenece a otro usuario');
    expect(await prisma.user.findUniqueOrThrow({ where: { id: fixture.doctorUser.id } })).toMatchObject({ email: 'doctor@zenda.test', clerkUserId: null });
    expect(await prisma.user.findUniqueOrThrow({ where: { id: other.id } })).toMatchObject({ email: NEW_DOCTOR_EMAIL });
    expect(await prisma.doctorProfile.count()).toBe(1);
  });

  it('lets future development seeds find the same migrated doctor without duplication', async () => {
    const fixture = await createDevelopmentDoctorFixture();
    await updateExistingDevelopmentDoctorEmail(prisma, NEW_DOCTOR_EMAIL);
    await seedDevelopmentData(seedEnvironment);
    await seedDevelopmentData(seedEnvironment);

    const doctor = await prisma.user.findUniqueOrThrow({ where: { emailNormalized: NEW_DOCTOR_EMAIL }, include: { doctorProfile: true } });
    expect(doctor).toMatchObject({ id: fixture.doctorUser.id, role: 'DOCTOR', doctorProfile: { id: fixture.doctor.id } });
    expect(await prisma.user.count({ where: { emailNormalized: NEW_DOCTOR_EMAIL } })).toBe(1);
    expect(await prisma.doctorProfile.count({ where: { userId: fixture.doctorUser.id } })).toBe(1);
  });
});
