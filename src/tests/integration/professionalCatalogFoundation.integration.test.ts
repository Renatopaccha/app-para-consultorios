import prisma, { disconnectPrisma } from '../../prisma';
import { assertIntegrationDatabase, clearIntegrationDatabase } from './testDatabase';

async function expectUniqueViolation(operation: Promise<unknown>) {
  await expect(operation).rejects.toMatchObject({ code: 'P2002' });
}

describe('fundación transitoria de catálogos profesionales', () => {
  beforeEach(async () => {
    assertIntegrationDatabase();
    await clearIntegrationDatabase();
  });

  afterAll(async () => {
    await clearIntegrationDatabase();
    await disconnectPrisma();
  });

  it('crea HealthProfession y protege code y nameNormalized con uniques', async () => {
    const profession = await prisma.healthProfession.create({
      data: { code: 'TEST_MEDICINE', name: 'Medicina de prueba', nameNormalized: 'medicina de prueba' },
    });

    expect(profession).toMatchObject({
      code: 'TEST_MEDICINE',
      nameNormalized: 'medicina de prueba',
      isActive: true,
      requiresSpecialty: false,
      credentialPolicyVersion: 1,
      sortOrder: 0,
    });
    await expectUniqueViolation(prisma.healthProfession.create({
      data: { code: 'TEST_MEDICINE', name: 'Otra', nameNormalized: 'otra' },
    }));
    await expectUniqueViolation(prisma.healthProfession.create({
      data: { code: 'TEST_OTHER', name: 'Duplicada', nameNormalized: 'medicina de prueba' },
    }));
  });

  it('protege los uniques compuestos de autoridad e institución', async () => {
    const profession = await prisma.healthProfession.create({
      data: { code: 'TEST_DENTISTRY', name: 'Odontología de prueba', nameNormalized: 'odontologia de prueba' },
    });
    await prisma.registrationAuthority.create({
      data: {
        countryCode: 'EC', registryNamespace: 'test-registry', name: 'Autoridad Test',
        nameNormalized: 'autoridad test', healthProfessionId: profession.id,
      },
    });
    await expectUniqueViolation(prisma.registrationAuthority.create({
      data: {
        countryCode: 'EC', registryNamespace: 'test-registry', name: 'Otra Autoridad',
        nameNormalized: 'otra autoridad',
      },
    }));
    await prisma.registrationAuthority.create({
      data: {
        countryCode: 'PE', registryNamespace: 'test-registry', name: 'Autoridad Perú',
        nameNormalized: 'autoridad peru',
      },
    });

    await prisma.institution.create({
      data: { countryCode: 'EC', name: 'Universidad Test', nameNormalized: 'universidad test' },
    });
    await expectUniqueViolation(prisma.institution.create({
      data: { countryCode: 'EC', name: 'Nombre alterno', nameNormalized: 'universidad test' },
    }));
    await prisma.institution.create({
      data: { countryCode: 'CO', name: 'Universidad Test', nameNormalized: 'universidad test' },
    });
  });

  it('protege code y nameNormalized de Language', async () => {
    await prisma.language.create({
      data: { code: 'x-test', name: 'Idioma de prueba', nameNormalized: 'idioma de prueba' },
    });
    await expectUniqueViolation(prisma.language.create({
      data: { code: 'x-test', name: 'Otro idioma', nameNormalized: 'otro idioma' },
    }));
    await expectUniqueViolation(prisma.language.create({
      data: { code: 'x-other', name: 'Duplicado', nameNormalized: 'idioma de prueba' },
    }));
  });

  it('mantiene Specialty enlazada obligatoriamente a su profesión', async () => {
    const profession = await prisma.healthProfession.create({
      data: { code: 'TEST_PSYCHOLOGY', name: 'Psicología de prueba', nameNormalized: 'psicologia de prueba' },
    });
    const specialty = await prisma.specialty.create({
      data: {
        name: 'Especialidad endurecida test',
        healthProfessionId: profession.id,
        code: 'TEST_SPECIALTY',
        nameNormalized: 'especialidad endurecida test',
      },
    });
    expect(specialty).toMatchObject({ healthProfessionId: profession.id, isActive: true });
  });

  it('no modifica User, DoctorProfile, clínica, workplace, servicio ni cita existentes', async () => {
    const patient = await prisma.user.create({
      data: { email: 'catalog.patient.integration@zenda.test', emailNormalized: 'catalog.patient.integration@zenda.test', firstName: 'Legacy', lastName: 'Patient', role: 'PATIENT' },
    });
    const doctorUser = await prisma.user.create({
      data: { email: 'catalog.doctor.integration@zenda.test', emailNormalized: 'catalog.doctor.integration@zenda.test', firstName: 'Legacy', lastName: 'Doctor', role: 'DOCTOR' },
    });
    const clinicUser = await prisma.user.create({
      data: { email: 'catalog.clinic.integration@zenda.test', emailNormalized: 'catalog.clinic.integration@zenda.test', firstName: 'Legacy', lastName: 'Clinic', role: 'CLINIC_ADMIN' },
    });
    const profession = await prisma.healthProfession.create({
      data: { code: 'TEST_LEGACY_GRAPH', name: 'Profesión legacy graph', nameNormalized: 'profesion legacy graph' },
    });
    const specialty = await prisma.specialty.create({
      data: {
        name: 'Legacy graph specialty', code: 'LEGACY_GRAPH_SPECIALTY',
        nameNormalized: 'legacy graph specialty', healthProfessionId: profession.id,
      },
    });
    const doctor = await prisma.doctorProfile.create({
      data: { userId: doctorUser.id, licenseNumber: 'CATALOG-LEGACY-1', consultationPrice: 25, specialties: { connect: { id: specialty.id } } },
    });
    const clinic = await prisma.clinicProfile.create({
      data: { userId: clinicUser.id, name: 'Legacy Graph Clinic', address: 'Legacy Address', specialties: { connect: { id: specialty.id } } },
    });
    const workplace = await prisma.doctorClinicWorkplace.create({ data: { doctorProfileId: doctor.id, clinicProfileId: clinic.id } });
    const service = await prisma.service.create({
      data: { name: 'Legacy Graph Service', price: 25, priceCents: 2500, duration: 30, doctorProfileId: doctor.id, clinicProfileId: clinic.id },
    });
    const appointment = await prisma.appointment.create({
      data: {
        patientId: patient.id, doctorProfileId: doctor.id, clinicProfileId: clinic.id, serviceId: service.id,
        date: new Date('2026-08-01T00:00:00.000Z'), startTime: '09:00', endTime: '09:30', status: 'COMPLETED',
      },
    });
    const before = {
      users: await prisma.user.findMany({ where: { id: { in: [patient.id, doctorUser.id, clinicUser.id] } }, orderBy: { id: 'asc' } }),
      doctor: await prisma.doctorProfile.findUniqueOrThrow({ where: { id: doctor.id } }),
      clinic: await prisma.clinicProfile.findUniqueOrThrow({ where: { id: clinic.id } }),
      workplace: await prisma.doctorClinicWorkplace.findUniqueOrThrow({ where: { id: workplace.id } }),
      service: await prisma.service.findUniqueOrThrow({ where: { id: service.id } }),
      appointment: await prisma.appointment.findUniqueOrThrow({ where: { id: appointment.id } }),
    };

    await prisma.healthProfession.create({
      data: { code: 'TEST_NO_SIDE_EFFECT', name: 'Sin efecto lateral', nameNormalized: 'sin efecto lateral' },
    });

    const after = {
      users: await prisma.user.findMany({ where: { id: { in: [patient.id, doctorUser.id, clinicUser.id] } }, orderBy: { id: 'asc' } }),
      doctor: await prisma.doctorProfile.findUniqueOrThrow({ where: { id: doctor.id } }),
      clinic: await prisma.clinicProfile.findUniqueOrThrow({ where: { id: clinic.id } }),
      workplace: await prisma.doctorClinicWorkplace.findUniqueOrThrow({ where: { id: workplace.id } }),
      service: await prisma.service.findUniqueOrThrow({ where: { id: service.id } }),
      appointment: await prisma.appointment.findUniqueOrThrow({ where: { id: appointment.id } }),
    };
    expect(after).toEqual(before);
  });
});
