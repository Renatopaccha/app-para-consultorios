import request from 'supertest';
import app from '../../app';
import prisma, { disconnectPrisma } from '../../prisma';
import { generateToken } from '../../utils/jwt';
import { assertIntegrationDatabase, clearIntegrationDatabase } from './testDatabase';

let sequence = 0;

async function actor(label: string) {
  sequence += 1;
  const email = `${label}.${sequence}@credential-submit.zenda.test`;
  const user = await prisma.user.create({ data: { email, emailNormalized: email, firstName: 'Credential', lastName: label, role: 'PATIENT' } });
  return { user, token: generateToken({ id: user.id, role: 'PATIENT' }) };
}

const auth = (token: string) => ({ Authorization: `Bearer ${token}` });

async function validDraft(userId: string, cycleNumber = 1) {
  const profession = await prisma.healthProfession.create({ data: {
    code: `MED_CSP_${sequence}_${cycleNumber}`,
    name: `Medicina CSP ${sequence} ${cycleNumber}`,
    nameNormalized: `medicina csp ${sequence} ${cycleNumber}`,
  } });
  const application = await prisma.professionalApplication.create({ data: {
    userId,
    cycleNumber,
    status: 'DRAFT',
    legalGivenNames: 'Ana',
    legalFamilyNames: 'Pérez',
    primaryPhoneE164: '+593999999999',
    practiceCountryCode: 'EC',
    healthProfessionId: profession.id,
  } });
  await prisma.professionalApplicationLocation.create({ data: {
    applicationId: application.id,
    countryCode: 'EC',
    city: 'Quito',
    street1: 'Av. Principal',
  } });
  return { application, profession };
}

async function linkedCredential(input: {
  userId: string;
  applicationId: string;
  credentialType?: 'PRIMARY_DEGREE' | 'SPECIALTY' | 'MASTER' | 'PHD' | 'OTHER_RELEVANT';
  isPrimary?: boolean;
}) {
  const credential = await prisma.professionalCredential.create({ data: {
    userId: input.userId,
    credentialType: input.credentialType ?? 'PRIMARY_DEGREE',
    countryCode: 'EC',
    exactTitle: 'Credencial de prueba',
    institutionNameSnapshot: 'Universidad de prueba',
  } });
  await prisma.professionalApplicationCredential.create({ data: {
    applicationId: input.applicationId,
    credentialId: credential.id,
    isPrimary: input.isPrimary ?? false,
  } });
  return credential;
}

async function eligibleDocument(input: {
  applicationId: string;
  credentialId: string;
  scanStatus?: 'PENDING' | 'CLEAN' | 'REJECTED' | 'ERROR';
  deletedAt?: Date | null;
  marker?: string;
}) {
  return prisma.credentialDocument.create({ data: {
    credentialId: input.credentialId,
    storageProvider: 'cloudinary',
    publicId: `zenda/professional-onboarding/applications/${input.applicationId}/credentials/${input.credentialId}/document-${input.marker ?? sequence}`,
    resourceType: 'raw',
    format: 'pdf',
    mimeType: 'application/pdf',
    sizeBytes: 100,
    checksumSha256: 'a'.repeat(64),
    scanStatus: input.scanStatus ?? 'PENDING',
    deletedAt: input.deletedAt ?? null,
  } });
}

function submit(token: string, key: string, expectedRevision = 1) {
  return request(app)
    .post('/api/professional-onboarding/submit')
    .set(auth(token))
    .set('Idempotency-Key', key)
    .send({ expectedRevision });
}

describe('credential-submit-v1 HTTP', () => {
  beforeAll(() => assertIntegrationDatabase());
  beforeEach(async () => clearIntegrationDatabase());
  afterAll(async () => {
    await clearIntegrationDatabase();
    await disconnectPrisma();
  });

  it('rechaza falta de primaria sin mutar solicitud ni filtrar datos sensibles', async () => {
    const owner = await actor('missing-primary');
    const { application } = await validDraft(owner.user.id);
    const response = await submit(owner.token, 'missing-primary').expect(422);

    expect(response.body).toEqual({
      code: 'PROFESSIONAL_APPLICATION_VALIDATION_FAILED',
      message: 'La solicitud todavía está incompleta.',
      details: {
        policyVersion: 'credential-submit-v1',
        fields: ['credentials'],
        violations: [{
          code: 'PRIMARY_CREDENTIAL_REQUIRED',
          target: { type: 'APPLICATION', id: application.id },
          field: 'credentials',
          message: 'Agrega un título profesional principal.',
        }],
      },
    });
    expect(JSON.stringify(response.body.details)).not.toMatch(/publicId|cloudinary|checksum|scanStatus|storageProvider|registrationNumber|identity|PENDING_REVIEW/i);
    expect(await prisma.professionalApplication.findUniqueOrThrow({ where: { id: application.id } })).toMatchObject({ status: 'DRAFT', currentRevision: 1 });
    expect(await prisma.professionalApplicationSnapshot.count()).toBe(0);
    expect(await prisma.professionalApplicationReviewLog.count()).toBe(0);
  });

  it('rechaza una primaria que no sea PRIMARY_DEGREE', async () => {
    const owner = await actor('wrong-primary');
    const { application } = await validDraft(owner.user.id);
    const credential = await linkedCredential({ userId: owner.user.id, applicationId: application.id, credentialType: 'SPECIALTY', isPrimary: true });
    await eligibleDocument({ applicationId: application.id, credentialId: credential.id });

    const response = await submit(owner.token, 'wrong-primary').expect(422);
    expect(response.body.details.violations).toContainEqual(expect.objectContaining({ code: 'PRIMARY_CREDENTIAL_REQUIRED' }));
  });

  it('rechaza primaria sin documento y no cuenta documento soft-deleted', async () => {
    const owner = await actor('missing-document');
    const { application } = await validDraft(owner.user.id);
    const primary = await linkedCredential({ userId: owner.user.id, applicationId: application.id, isPrimary: true });

    let response = await submit(owner.token, 'no-document').expect(422);
    expect(response.body.details.violations).toContainEqual(expect.objectContaining({ code: 'PRIMARY_CREDENTIAL_DOCUMENT_REQUIRED' }));

    await eligibleDocument({ applicationId: application.id, credentialId: primary.id, deletedAt: new Date(), marker: 'deleted' });
    response = await submit(owner.token, 'soft-deleted-document').expect(422);
    expect(response.body.details.violations).toContainEqual(expect.objectContaining({ code: 'PRIMARY_CREDENTIAL_DOCUMENT_REQUIRED' }));
  });

  it.each(['REJECTED', 'ERROR'] as const)('no cuenta %s como única evidencia', async (scanStatus) => {
    const owner = await actor(`scan-${scanStatus.toLowerCase()}`);
    const { application } = await validDraft(owner.user.id);
    const primary = await linkedCredential({ userId: owner.user.id, applicationId: application.id, isPrimary: true });
    await eligibleDocument({ applicationId: application.id, credentialId: primary.id, scanStatus });

    const response = await submit(owner.token, `scan-${scanStatus.toLowerCase()}`).expect(422);
    expect(response.body.details.violations).toContainEqual(expect.objectContaining({ code: 'PRIMARY_CREDENTIAL_DOCUMENT_REQUIRED' }));
    expect(JSON.stringify(response.body.details)).not.toContain(scanStatus);
  });

  it('permite PENDING, no lo convierte en CLEAN/verified y conserva retry idempotente', async () => {
    const owner = await actor('pending-success');
    const { application } = await validDraft(owner.user.id);
    const primary = await linkedCredential({ userId: owner.user.id, applicationId: application.id, isPrimary: true });
    await eligibleDocument({ applicationId: application.id, credentialId: primary.id, scanStatus: 'PENDING' });

    const first = await submit(owner.token, 'pending-success').expect(200);
    const retry = await submit(owner.token, 'pending-success').expect(200);
    expect(first.body).toMatchObject({ idempotent: false, application: { status: 'PENDING_REVIEW', currentRevision: 2 } });
    expect(retry.body).toMatchObject({ idempotent: true, snapshot: { id: first.body.snapshot.id } });
    expect(await prisma.professionalApplicationSnapshot.count()).toBe(1);
    expect(await prisma.professionalApplicationReviewLog.count()).toBe(1);

    const snapshot = await prisma.professionalApplicationSnapshot.findUniqueOrThrow({ where: { id: first.body.snapshot.id } });
    const payload = snapshot.payload as { application: { credentials: Array<{ verificationStatus: string; documents: Array<{ scanStatus: string }> }> } };
    expect(payload.application.credentials[0]).toMatchObject({
      verificationStatus: 'UNVERIFIED',
      documents: [expect.objectContaining({ scanStatus: 'PENDING' })],
    });
    expect(payload.application.credentials[0]!.documents[0]!.scanStatus).not.toBe('CLEAN');
  });

  it('aplica la regla agregada de especialidad y exige documento elegible', async () => {
    const owner = await actor('specialty');
    const { application, profession } = await validDraft(owner.user.id);
    const specialty = await prisma.specialty.create({ data: {
      healthProfessionId: profession.id,
      code: `CARD_CSP_${sequence}`,
      name: `Cardiología CSP ${sequence}`,
      nameNormalized: `cardiologia csp ${sequence}`,
    } });
    await prisma.professionalApplicationSpecialty.create({ data: { applicationId: application.id, specialtyId: specialty.id, isPrimary: true } });
    const primary = await linkedCredential({ userId: owner.user.id, applicationId: application.id, isPrimary: true });
    await eligibleDocument({ applicationId: application.id, credentialId: primary.id });

    let response = await submit(owner.token, 'specialty-missing').expect(422);
    expect(response.body.details.violations).toContainEqual(expect.objectContaining({ code: 'SPECIALTY_CREDENTIAL_REQUIRED' }));

    await linkedCredential({ userId: owner.user.id, applicationId: application.id, credentialType: 'SPECIALTY' });
    response = await submit(owner.token, 'specialty-document-missing').expect(422);
    expect(response.body.details.violations).toContainEqual(expect.objectContaining({ code: 'SPECIALTY_CREDENTIAL_DOCUMENT_REQUIRED' }));
  });

  it('MASTER, PHD y OTHER_RELEVANT no son requisitos de submit', async () => {
    const owner = await actor('optional-types');
    const { application } = await validDraft(owner.user.id);
    const primary = await linkedCredential({ userId: owner.user.id, applicationId: application.id, isPrimary: true });
    await eligibleDocument({ applicationId: application.id, credentialId: primary.id });

    await submit(owner.token, 'optional-types').expect(200);
    expect(await prisma.professionalCredential.count({ where: { credentialType: { in: ['MASTER', 'PHD', 'OTHER_RELEVANT'] } } })).toBe(0);
  });

  it('no cuenta credenciales cross-user ni credenciales propias no vinculadas a la solicitud actual', async () => {
    const [owner, outsider] = await Promise.all([actor('owner'), actor('outsider')]);
    const { application } = await validDraft(owner.user.id);
    const foreign = await prisma.professionalCredential.create({ data: {
      userId: outsider.user.id,
      credentialType: 'PRIMARY_DEGREE',
      countryCode: 'EC',
      exactTitle: 'Ajena',
      institutionNameSnapshot: 'Institución ajena',
    } });
    await prisma.professionalApplicationCredential.create({ data: { applicationId: application.id, credentialId: foreign.id, isPrimary: true } });
    await eligibleDocument({ applicationId: application.id, credentialId: foreign.id, marker: 'foreign' });
    let response = await submit(owner.token, 'cross-user').expect(422);
    expect(response.body.details.violations).toContainEqual(expect.objectContaining({ code: 'PRIMARY_CREDENTIAL_REQUIRED' }));
    expect(JSON.stringify(response.body)).not.toContain('Institución ajena');

    await prisma.professionalApplicationCredential.deleteMany({ where: { applicationId: application.id } });
    const historical = await prisma.professionalApplication.create({ data: {
      userId: owner.user.id,
      cycleNumber: 2,
      status: 'APPROVED',
      submittedAt: new Date(),
      decidedAt: new Date(),
    } });
    const ownHistorical = await linkedCredential({ userId: owner.user.id, applicationId: historical.id, isPrimary: true });
    await eligibleDocument({ applicationId: historical.id, credentialId: ownHistorical.id, marker: 'historical' });
    response = await submit(owner.token, 'cross-application').expect(422);
    expect(response.body.details.violations).toContainEqual(expect.objectContaining({ code: 'PRIMARY_CREDENTIAL_REQUIRED' }));
  });
});
