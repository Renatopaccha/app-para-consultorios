import prisma, { disconnectPrisma } from '../../prisma';
import {
  attachProfessionalApplicationCredential,
  attachProfessionalApplicationSpecialty,
  ProfessionalApplicationInvariantError,
} from '../../services/professionalApplication.service';
import { assertIntegrationDatabase, clearIntegrationDatabase } from './testDatabase';

let sequence = 0;

async function createUser(label: string) {
  sequence += 1;
  const email = `${label}.${sequence}@application-aggregate.zenda.test`;
  return prisma.user.create({
    data: { email, emailNormalized: email, firstName: 'Application', lastName: label, role: 'PATIENT' },
  });
}

async function createProfession(code: string, name: string) {
  return prisma.healthProfession.create({
    data: { code, name, nameNormalized: name.toLowerCase().normalize('NFD').replace(/\p{M}+/gu, '') },
  });
}

async function createDraftApplication(userId: string, cycleNumber = 1, healthProfessionId?: string) {
  return prisma.professionalApplication.create({
    data: { userId, cycleNumber, healthProfessionId },
  });
}

async function expectUniqueViolation(operation: Promise<unknown>) {
  await expect(operation).rejects.toMatchObject({ code: 'P2002' });
}

describe('agregado de ProfessionalApplication', () => {
  beforeEach(async () => {
    assertIntegrationDatabase();
    await clearIntegrationDatabase();
  });

  afterAll(async () => {
    await clearIntegrationDatabase();
    await disconnectPrisma();
  });

  it('conserva ciclos históricos y permite una sola solicitud activa por User', async () => {
    const user = await createUser('cycles');
    const submittedAt = new Date('2026-01-01T00:00:00Z');
    await prisma.professionalApplication.create({
      data: {
        userId: user.id, cycleNumber: 1, status: 'REJECTED',
        submittedAt, decidedAt: new Date('2026-01-02T00:00:00Z'),
      },
    });
    await createDraftApplication(user.id, 2);
    await expectUniqueViolation(createDraftApplication(user.id, 3));
    expect(await prisma.professionalApplication.count({ where: { userId: user.id } })).toBe(2);
  });

  it('enlaza Specialty de la misma profesión y limita la primaria', async () => {
    const user = await createUser('specialties');
    const [medicine, dentistry] = await Promise.all([
      createProfession('MEDICINE_TEST', 'Medicina test'),
      createProfession('DENTISTRY_TEST', 'Odontología test'),
    ]);
    const [cardiology, general, orthodontics] = await Promise.all([
      prisma.specialty.create({ data: { healthProfessionId: medicine.id, code: 'CARDIOLOGY_TEST', name: 'Cardiología test', nameNormalized: 'cardiologia test' } }),
      prisma.specialty.create({ data: { healthProfessionId: medicine.id, code: 'GENERAL_TEST', name: 'General test', nameNormalized: 'general test' } }),
      prisma.specialty.create({ data: { healthProfessionId: dentistry.id, code: 'ORTHODONTICS_TEST', name: 'Ortodoncia test', nameNormalized: 'ortodoncia test' } }),
    ]);
    const application = await createDraftApplication(user.id, 1, medicine.id);
    await attachProfessionalApplicationSpecialty(prisma, { applicationId: application.id, specialtyId: cardiology.id, isPrimary: true });
    await expectUniqueViolation(attachProfessionalApplicationSpecialty(prisma, {
      applicationId: application.id, specialtyId: general.id, isPrimary: true,
    }));
    await expect(attachProfessionalApplicationSpecialty(prisma, {
      applicationId: application.id, specialtyId: orthodontics.id,
    })).rejects.toMatchObject<Partial<ProfessionalApplicationInvariantError>>({ code: 'SPECIALTY_PROFESSION_MISMATCH' });
    expect(await prisma.professionalApplicationSpecialty.count()).toBe(1);
  });

  it('protege ownership, tuple registral y primary credential', async () => {
    const [owner, other] = await Promise.all([createUser('credential-owner'), createUser('credential-other')]);
    const application = await createDraftApplication(owner.id);
    const authority = await prisma.registrationAuthority.create({
      data: {
        countryCode: 'EC', registryNamespace: 'TEST:CREDENTIAL',
        name: 'Autoridad credencial test', nameNormalized: 'autoridad credencial test',
      },
    });
    const registered = await prisma.professionalCredential.create({
      data: {
        userId: owner.id, credentialType: 'PRIMARY_DEGREE', countryCode: 'EC', exactTitle: 'Médico',
        institutionNameSnapshot: 'Universidad manual', registrationAuthorityId: authority.id,
        registrationNumberOriginal: 'ABC-001', registrationNumberNormalized: 'ABC001',
      },
    });
    expect(registered.institutionId).toBeNull();
    await attachProfessionalApplicationCredential(prisma, {
      applicationId: application.id, credentialId: registered.id, isPrimary: true,
    });
    await expectUniqueViolation(prisma.professionalCredential.create({
      data: {
        userId: other.id, credentialType: 'SPECIALTY', countryCode: 'EC', exactTitle: 'Especialista',
        institutionNameSnapshot: 'Otra universidad', registrationAuthorityId: authority.id,
        registrationNumberOriginal: 'ABC-001', registrationNumberNormalized: 'ABC001',
      },
    }));
    await expect(prisma.professionalCredential.create({
      data: {
        userId: owner.id, credentialType: 'MASTER', countryCode: 'EC', exactTitle: 'Tuple incompleta',
        institutionNameSnapshot: 'Universidad', registrationAuthorityId: authority.id,
      },
    })).rejects.toThrow();
    const ownerWithoutRegistry = await prisma.professionalCredential.create({
      data: {
        userId: owner.id, credentialType: 'MASTER', countryCode: 'EC', exactTitle: 'Sin registro',
        institutionNameSnapshot: 'Institución manual',
      },
    });
    await prisma.professionalCredential.create({
      data: {
        userId: owner.id, credentialType: 'MASTER', countryCode: 'EC', exactTitle: 'Sin registro repetible',
        institutionNameSnapshot: 'Institución manual',
      },
    });
    await expectUniqueViolation(attachProfessionalApplicationCredential(prisma, {
      applicationId: application.id, credentialId: ownerWithoutRegistry.id, isPrimary: true, sortOrder: 1,
    }));
    const foreignCredential = await prisma.professionalCredential.create({
      data: {
        userId: other.id, credentialType: 'OTHER_RELEVANT', countryCode: 'EC', exactTitle: 'Ajena',
        institutionNameSnapshot: 'Institución manual',
      },
    });
    await expect(attachProfessionalApplicationCredential(prisma, {
      applicationId: application.id, credentialId: foreignCredential.id,
    })).rejects.toMatchObject<Partial<ProfessionalApplicationInvariantError>>({ code: 'CREDENTIAL_OWNER_MISMATCH' });
  });

  it('valida metadata privada de documentos', async () => {
    const user = await createUser('documents');
    const credential = await prisma.professionalCredential.create({
      data: {
        userId: user.id, credentialType: 'PRIMARY_DEGREE', countryCode: 'EC',
        exactTitle: 'Título documental', institutionNameSnapshot: 'Universidad',
      },
    });
    await prisma.credentialDocument.create({
      data: {
        credentialId: credential.id, storageProvider: 'cloudinary', publicId: 'private/document-1',
        resourceType: 'raw', format: 'pdf', mimeType: 'application/pdf', sizeBytes: 100,
        checksumSha256: 'a'.repeat(64), pageCount: 1,
      },
    });
    await expect(prisma.credentialDocument.create({
      data: {
        credentialId: credential.id, storageProvider: 'cloudinary', publicId: 'private/document-zero',
        resourceType: 'raw', format: 'pdf', mimeType: 'application/pdf', sizeBytes: 0,
        checksumSha256: 'b'.repeat(64),
      },
    })).rejects.toThrow();
    await expect(prisma.credentialDocument.create({
      data: {
        credentialId: credential.id, storageProvider: 'cloudinary', publicId: 'private/document-bad-hash',
        resourceType: 'raw', format: 'pdf', mimeType: 'application/pdf', sizeBytes: 10,
        checksumSha256: 'not-a-sha256'.padEnd(64, 'x'),
      },
    })).rejects.toThrow();
  });

  it('permite ubicación draft y valida piso, coordenadas y provider pairing', async () => {
    const validApp = await createDraftApplication((await createUser('location-valid')).id);
    await prisma.professionalApplicationLocation.create({
      data: {
        applicationId: validApp.id, floorNumber: 0, latitude: -0.180653,
        longitude: -78.467834, providerType: 'google_places', providerPlaceId: 'test-place',
      },
    });
    expect((await prisma.professionalApplicationLocation.findUniqueOrThrow({ where: { applicationId: validApp.id } })).confirmedAt).toBeNull();

    const invalidFloor = await createDraftApplication((await createUser('location-floor')).id);
    await expect(prisma.professionalApplicationLocation.create({
      data: { applicationId: invalidFloor.id, floorNumber: -1 },
    })).rejects.toThrow();
    const invalidPair = await createDraftApplication((await createUser('location-pair')).id);
    await expect(prisma.professionalApplicationLocation.create({
      data: { applicationId: invalidPair.id, latitude: 10 },
    })).rejects.toThrow();
    const invalidRange = await createDraftApplication((await createUser('location-range')).id);
    await expect(prisma.professionalApplicationLocation.create({
      data: { applicationId: invalidRange.id, latitude: 91, longitude: 0 },
    })).rejects.toThrow();
    const invalidProvider = await createDraftApplication((await createUser('location-provider')).id);
    await expect(prisma.professionalApplicationLocation.create({
      data: { applicationId: invalidProvider.id, providerPlaceId: 'orphan-place' },
    })).rejects.toThrow();
  });

  it('admite múltiples idiomas sin duplicar el mismo catálogo', async () => {
    const application = await createDraftApplication((await createUser('languages')).id);
    const [spanish, english] = await Promise.all([
      prisma.language.create({ data: { code: 'es-test', name: 'Español test', nameNormalized: 'espanol test' } }),
      prisma.language.create({ data: { code: 'en-test', name: 'Inglés test', nameNormalized: 'ingles test' } }),
    ]);
    await prisma.professionalApplicationLanguage.createMany({
      data: [
        { applicationId: application.id, languageId: spanish.id },
        { applicationId: application.id, languageId: english.id, proficiency: 'C1' },
      ],
    });
    await expectUniqueViolation(prisma.professionalApplicationLanguage.create({
      data: { applicationId: application.id, languageId: spanish.id },
    }));
    expect(await prisma.professionalApplicationLanguage.count()).toBe(2);
  });

  it('limita avatar y orden de assets activos y valida metadata', async () => {
    const application = await createDraftApplication((await createUser('assets')).id);
    const asset = (category: 'AVATAR' | 'PRACTICE_INTERIOR' | 'PRACTICE_EXTERIOR', publicId: string, sortOrder: number) => ({
      applicationId: application.id, category, storageProvider: 'cloudinary', publicId,
      resourceType: 'image', format: 'jpg', mimeType: 'image/jpeg', sizeBytes: 100,
      width: 100, height: 100, checksumSha256: 'c'.repeat(64), sortOrder,
    });
    const firstAvatar = await prisma.professionalApplicationAsset.create({ data: asset('AVATAR', 'avatar-1', 0) });
    await expectUniqueViolation(prisma.professionalApplicationAsset.create({ data: asset('AVATAR', 'avatar-2', 1) }));
    await prisma.professionalApplicationAsset.update({ where: { id: firstAvatar.id }, data: { deletedAt: new Date() } });
    await prisma.professionalApplicationAsset.create({ data: asset('AVATAR', 'avatar-2', 1) });
    await prisma.professionalApplicationAsset.create({ data: asset('PRACTICE_INTERIOR', 'interior-1', 0) });
    await expectUniqueViolation(prisma.professionalApplicationAsset.create({ data: asset('PRACTICE_INTERIOR', 'interior-2', 0) }));
    await expect(prisma.professionalApplicationAsset.create({
      data: { ...asset('PRACTICE_EXTERIOR', 'bad-dimensions', 0), width: 0 },
    })).rejects.toThrow();
  });

  it('protege revisiones de snapshot y registra review logs históricos', async () => {
    const [applicant, reviewer] = await Promise.all([createUser('snapshot-applicant'), createUser('snapshot-reviewer')]);
    const submittedAt = new Date('2026-02-01T00:00:00Z');
    const application = await prisma.professionalApplication.create({
      data: { userId: applicant.id, cycleNumber: 1, status: 'PENDING_REVIEW', submittedAt },
    });
    const snapshot = await prisma.professionalApplicationSnapshot.create({
      data: { applicationId: application.id, revision: 1, schemaVersion: 1, payload: { version: 1 }, payloadHash: 'd'.repeat(64) },
    });
    await expectUniqueViolation(prisma.professionalApplicationSnapshot.create({
      data: { applicationId: application.id, revision: 1, schemaVersion: 1, payload: {}, payloadHash: 'e'.repeat(64) },
    }));
    await expect(prisma.professionalApplicationSnapshot.create({
      data: { applicationId: application.id, revision: 0, schemaVersion: 1, payload: {}, payloadHash: 'e'.repeat(64) },
    })).rejects.toThrow();
    await prisma.professionalApplicationReviewLog.create({
      data: {
        applicationId: application.id, snapshotId: snapshot.id, actorUserId: reviewer.id,
        action: 'SUBMITTED', previousStatus: 'DRAFT', newStatus: 'PENDING_REVIEW', idempotencyKey: 'submit-1',
      },
    });
    await expectUniqueViolation(prisma.professionalApplicationReviewLog.create({
      data: { applicationId: application.id, action: 'SUBMITTED', newStatus: 'PENDING_REVIEW', idempotencyKey: 'submit-1' },
    }));
    await expect(prisma.professionalApplication.delete({ where: { id: application.id } })).rejects.toThrow();
  });

  it('mantiene la identidad regulatoria cifrada, privada y única entre Users', async () => {
    const [firstUser, secondUser] = await Promise.all([createUser('regulatory-first'), createUser('regulatory-second')]);
    const application = await createDraftApplication(firstUser.id);
    const identity = await prisma.professionalRegulatoryIdentity.create({
      data: {
        userId: firstUser.id, applicationId: application.id, countryCode: 'EC',
        authorityNamespace: 'ACESS:HEALTH_PROFESSIONAL_REGISTRY', documentType: 'NATIONAL_ID',
        documentNumberCiphertext: 'v1:encrypted-document-payload', documentNumberFingerprint: 'f'.repeat(64),
        encryptionKeyVersion: 1,
      },
    });
    await expectUniqueViolation(prisma.professionalRegulatoryIdentity.create({
      data: {
        userId: secondUser.id, countryCode: 'EC', authorityNamespace: 'ACESS:HEALTH_PROFESSIONAL_REGISTRY',
        documentType: 'NATIONAL_ID', documentNumberCiphertext: 'v1:another-encrypted-payload',
        documentNumberFingerprint: 'f'.repeat(64), encryptionKeyVersion: 1,
      },
    }));
    const columns = await prisma.$queryRaw<Array<{ column_name: string }>>`
      SELECT column_name FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'ProfessionalRegulatoryIdentity'
    `;
    const names = columns.map(({ column_name }) => column_name);
    expect(names).toEqual(expect.arrayContaining(['documentNumberCiphertext', 'documentNumberFingerprint']));
    expect(names).not.toContain('documentNumberOriginal');
    expect(names).not.toContain('documentNumberNormalized');
    await prisma.professionalRegulatoryIdentity.update({ where: { id: identity.id }, data: { deletedAt: new Date() } });
    await prisma.professionalRegulatoryIdentity.create({
      data: {
        userId: secondUser.id, countryCode: 'EC', authorityNamespace: 'ACESS:HEALTH_PROFESSIONAL_REGISTRY',
        documentType: 'NATIONAL_ID', documentNumberCiphertext: 'v1:another-encrypted-payload',
        documentNumberFingerprint: 'f'.repeat(64), encryptionKeyVersion: 1,
      },
    });
  });

  it('revierte fixtures completos cuando falla una transacción', async () => {
    const user = await createUser('rollback');
    await expect(prisma.$transaction(async (tx) => {
      const application = await tx.professionalApplication.create({ data: { userId: user.id, cycleNumber: 1 } });
      await tx.professionalApplicationLocation.create({ data: { applicationId: application.id, floorNumber: 0 } });
      throw new Error('ROLLBACK_TEST');
    })).rejects.toThrow('ROLLBACK_TEST');
    expect(await prisma.professionalApplication.count({ where: { userId: user.id } })).toBe(0);
    expect(await prisma.professionalApplicationLocation.count()).toBe(0);
  });

  it('no altera IDs ni relaciones operativas legacy al crear una solicitud', async () => {
    const [patient, doctorUser, clinicUser] = await Promise.all([
      createUser('legacy-patient'), createUser('legacy-doctor'), createUser('legacy-clinic'),
    ]);
    const profession = await createProfession('LEGACY_MEDICINE', 'Legacy Medicina');
    const specialty = await prisma.specialty.create({
      data: { healthProfessionId: profession.id, code: 'LEGACY_CARDIOLOGY', name: 'Legacy Cardiología', nameNormalized: 'legacy cardiologia' },
    });
    const doctor = await prisma.doctorProfile.create({
      data: { userId: doctorUser.id, licenseNumber: 'APPLICATION-LEGACY-DOCTOR', consultationPrice: 50, specialties: { connect: { id: specialty.id } } },
    });
    const clinic = await prisma.clinicProfile.create({
      data: { userId: clinicUser.id, name: 'Application Legacy Clinic', address: 'Test', specialties: { connect: { id: specialty.id } } },
    });
    const service = await prisma.service.create({
      data: { name: 'Application Legacy Service', price: 50, priceCents: 5000, duration: 30, doctorProfileId: doctor.id, clinicProfileId: clinic.id },
    });
    const appointment = await prisma.appointment.create({
      data: {
        patientId: patient.id, doctorProfileId: doctor.id, clinicProfileId: clinic.id, serviceId: service.id,
        date: new Date('2099-03-01T13:00:00Z'), startTime: '08:00', endTime: '08:30',
        startsAt: new Date('2099-03-01T13:00:00Z'), endsAt: new Date('2099-03-01T13:30:00Z'),
      },
    });
    const before = {
      doctor: await prisma.doctorProfile.findUniqueOrThrow({ where: { id: doctor.id }, include: { specialties: true } }),
      clinic: await prisma.clinicProfile.findUniqueOrThrow({ where: { id: clinic.id }, include: { specialties: true } }),
      service: await prisma.service.findUniqueOrThrow({ where: { id: service.id } }),
      appointment: await prisma.appointment.findUniqueOrThrow({ where: { id: appointment.id } }),
    };
    await createDraftApplication(doctorUser.id, 1, profession.id);
    const after = {
      doctor: await prisma.doctorProfile.findUniqueOrThrow({ where: { id: doctor.id }, include: { specialties: true } }),
      clinic: await prisma.clinicProfile.findUniqueOrThrow({ where: { id: clinic.id }, include: { specialties: true } }),
      service: await prisma.service.findUniqueOrThrow({ where: { id: service.id } }),
      appointment: await prisma.appointment.findUniqueOrThrow({ where: { id: appointment.id } }),
    };
    expect(after).toEqual(before);
  });
});
