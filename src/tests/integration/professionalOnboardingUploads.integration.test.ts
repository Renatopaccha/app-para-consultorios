import request from 'supertest';
import app from '../../app';
import prisma, { disconnectPrisma } from '../../prisma';
import { setOnboardingStorageAdaptersForTests } from '../../services/professionalOnboardingStorage.service';
import { generateToken } from '../../utils/jwt';
import { assertIntegrationDatabase, clearIntegrationDatabase } from './testDatabase';

let sequence = 0;
let uploadSequence = 0;
const removed: string[] = [];

function png(width = 10, height = 10) {
  const buffer = Buffer.alloc(24);
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(buffer);
  buffer.write('IHDR', 12, 'ascii'); buffer.writeUInt32BE(width, 16); buffer.writeUInt32BE(height, 20);
  return buffer;
}
const pdf = Buffer.from('%PDF-1.4\n1 0 obj\n<< /Type /Page >>\nendobj\n%%EOF', 'ascii');

async function actor(label: string) {
  sequence += 1;
  const email = `${label}.${sequence}@upload.zenda.test`;
  const user = await prisma.user.create({ data: { email, emailNormalized: email, firstName: 'Upload', lastName: label, role: 'PATIENT' } });
  return { user, token: generateToken({ id: user.id, role: 'PATIENT' }) };
}
const bearer = (token: string) => ({ Authorization: `Bearer ${token}` });

async function application(userId: string, status: 'DRAFT' | 'NEEDS_CHANGES' | 'PENDING_REVIEW' | 'APPROVED' = 'DRAFT') {
  return prisma.professionalApplication.create({ data: {
    userId, cycleNumber: 1, status,
    ...(status !== 'DRAFT' ? { submittedAt: new Date() } : {}),
    ...(status === 'APPROVED' ? { decidedAt: new Date() } : {}),
  } });
}

async function credential(userId: string, applicationId: string) {
  const item = await prisma.professionalCredential.create({ data: { userId, credentialType: 'PRIMARY_DEGREE', countryCode: 'EC', exactTitle: 'Médico', institutionNameSnapshot: 'Universidad' } });
  await prisma.professionalApplicationCredential.create({ data: { applicationId, credentialId: item.id, isPrimary: true } });
  return item;
}

describe('professional onboarding secure uploads', () => {
  beforeAll(() => assertIntegrationDatabase());
  beforeEach(async () => {
    await clearIntegrationDatabase(); uploadSequence = 0; removed.length = 0;
    setOnboardingStorageAdaptersForTests({
      upload: async (_buffer, options) => ({ publicId: `${options.folder}/${options.public_id}-${++uploadSequence}`, format: options.resource_type === 'raw' ? 'pdf' : 'png' }),
      remove: async (publicId) => { removed.push(publicId); },
      access: (publicId, format, options) => `https://temporary.test/${publicId}.${format}?expires=${options.expires_at}`,
    });
  });
  afterAll(async () => { setOnboardingStorageAdaptersForTests(); await clearIntegrationDatabase(); await disconnectPrisma(); });

  it('DRAFT sube asset privado y otro user no puede accederlo ni controlarlo', async () => {
    const [owner, outsider] = await Promise.all([actor('owner'), actor('outsider')]);
    await application(owner.user.id);
    const uploaded = await request(app).post('/api/professional-onboarding/assets').set(bearer(owner.token))
      .field('category', 'AVATAR').field('expectedRevision', '1').field('folder', 'attacker/path').field('publicId', 'chosen')
      .attach('file', png(), { filename: 'avatar.png', contentType: 'image/png' }).expect(201);
    expect(uploaded.body).toMatchObject({ currentRevision: 2, asset: { category: 'AVATAR', mimeType: 'image/png', moderationStatus: 'PENDING' } });
    expect(JSON.stringify(uploaded.body)).not.toMatch(/publicId|folder|temporary\.test/);
    await request(app).get(`/api/professional-onboarding/assets/${uploaded.body.asset.id}/access`).set(bearer(outsider.token)).expect(404);
    const access = await request(app).get(`/api/professional-onboarding/assets/${uploaded.body.asset.id}/access`).set(bearer(owner.token)).expect(200);
    expect(access.body).toMatchObject({ expiresInSeconds: 300 });
    expect(access.body.url).toContain('expires=');
  });

  it('rechaza MIME inválido, SVG, exceso de tamaño y revisión obsoleta', async () => {
    const owner = await actor('invalid'); await application(owner.user.id);
    await request(app).post('/api/professional-onboarding/assets').set(bearer(owner.token)).field('category', 'AVATAR').field('expectedRevision', '1')
      .attach('file', Buffer.from('<svg/>'), { filename: 'bad.svg', contentType: 'image/svg+xml' }).expect(422);
    await request(app).post('/api/professional-onboarding/assets').set(bearer(owner.token)).field('category', 'AVATAR').field('expectedRevision', '1')
      .attach('file', png(), { filename: 'fake.jpg', contentType: 'image/jpeg' }).expect(422);
    await request(app).post('/api/professional-onboarding/assets').set(bearer(owner.token)).field('category', 'AVATAR').field('expectedRevision', '1')
      .attach('file', Buffer.alloc(5 * 1024 * 1024 + 1), { filename: 'huge.png', contentType: 'image/png' }).expect(413);
    const valid = await request(app).post('/api/professional-onboarding/assets').set(bearer(owner.token)).field('category', 'AVATAR').field('expectedRevision', '1')
      .attach('file', png(), { filename: 'ok.png', contentType: 'image/png' }).expect(201);
    await request(app).post('/api/professional-onboarding/assets').set(bearer(owner.token)).field('category', 'PRACTICE_INTERIOR').field('expectedRevision', '1')
      .attach('file', png(), { filename: 'stale.png', contentType: 'image/png' }).expect(409);
    expect(valid.body.currentRevision).toBe(2);
  });

  it('reemplaza avatar tras commit DB, conserva soft-delete y limpia el anterior', async () => {
    const owner = await actor('avatar'); await application(owner.user.id);
    const first = await request(app).post('/api/professional-onboarding/assets').set(bearer(owner.token)).field('category', 'AVATAR').field('expectedRevision', '1').attach('file', png(), 'first.png').expect(201);
    const second = await request(app).post('/api/professional-onboarding/assets').set(bearer(owner.token)).field('category', 'AVATAR').field('expectedRevision', '2').attach('file', png(), 'second.png').expect(201);
    expect(second.body.currentRevision).toBe(3);
    const records = await prisma.professionalApplicationAsset.findMany({ where: { category: 'AVATAR' }, orderBy: { createdAt: 'asc' } });
    expect(records).toHaveLength(2); expect(records[0]!.deletedAt).not.toBeNull(); expect(records[1]!.deletedAt).toBeNull();
    await new Promise((resolve) => setImmediate(resolve));
    expect(removed).toContain(records[0]!.publicId);
    expect(first.body.asset.id).toBe(records[0]!.id);
  });

  it('soporta múltiples fotos de práctica, exterior múltiple según schema y reordenamiento seguro', async () => {
    const owner = await actor('practice'); await application(owner.user.id);
    const first = await request(app).post('/api/professional-onboarding/assets').set(bearer(owner.token)).field('category', 'PRACTICE_INTERIOR').field('sortOrder', '0').field('expectedRevision', '1').attach('file', png(), 'one.png').expect(201);
    const second = await request(app).post('/api/professional-onboarding/assets').set(bearer(owner.token)).field('category', 'PRACTICE_INTERIOR').field('sortOrder', '1').field('expectedRevision', '2').attach('file', png(), 'two.png').expect(201);
    await request(app).post('/api/professional-onboarding/assets').set(bearer(owner.token)).field('category', 'PRACTICE_EXTERIOR').field('expectedRevision', '3').attach('file', png(), 'outside-one.png').expect(201);
    await request(app).post('/api/professional-onboarding/assets').set(bearer(owner.token)).field('category', 'PRACTICE_EXTERIOR').field('expectedRevision', '4').attach('file', png(), 'outside-two.png').expect(201);
    const ordered = await request(app).put('/api/professional-onboarding/assets/order').set(bearer(owner.token)).send({ expectedRevision: 5, items: [{ assetId: first.body.asset.id, sortOrder: 1 }, { assetId: second.body.asset.id, sortOrder: 0 }] }).expect(200);
    expect(ordered.body.currentRevision).toBe(6);
    expect(ordered.body.items.filter((item: { category: string }) => item.category === 'PRACTICE_INTERIOR').map((item: { id: string }) => item.id)).toEqual([second.body.asset.id, first.body.asset.id]);
  });

  it('documento siempre privado valida ownership, queda PENDING y se elimina por soft-delete', async () => {
    const [owner, outsider] = await Promise.all([actor('doc-owner'), actor('doc-outsider')]);
    const appRecord = await application(owner.user.id); const item = await credential(owner.user.id, appRecord.id);
    const uploaded = await request(app).post(`/api/professional-onboarding/credentials/${item.id}/documents`).set(bearer(owner.token)).field('expectedRevision', '1').field('kind', 'PRIMARY_EVIDENCE')
      .attach('file', pdf, { filename: 'degree.pdf', contentType: 'application/pdf' }).expect(201);
    expect(uploaded.body).toMatchObject({ currentRevision: 2, document: { scanStatus: 'PENDING', scannedAt: null, mimeType: 'application/pdf', pageCount: 1 } });
    expect(JSON.stringify(uploaded.body)).not.toMatch(/publicId|cloudinary|temporary\.test/);
    const documentId = uploaded.body.document.id;
    await request(app).get(`/api/professional-onboarding/credentials/${item.id}/documents/${documentId}/access`).set(bearer(outsider.token)).expect(404);
    await request(app).delete(`/api/professional-onboarding/credentials/${item.id}/documents/${documentId}`).set(bearer(owner.token)).send({ expectedRevision: 2 }).expect(200);
    expect((await prisma.credentialDocument.findUniqueOrThrow({ where: { id: documentId } })).deletedAt).not.toBeNull();
  });

  it.each(['PENDING_REVIEW', 'APPROVED'] as const)('%s permite lectura al owner pero no mutación', async (status) => {
    const owner = await actor(status.toLowerCase()); const appRecord = await application(owner.user.id, status);
    const asset = await prisma.professionalApplicationAsset.create({ data: { applicationId: appRecord.id, category: 'AVATAR', storageProvider: 'cloudinary', publicId: `private-${status}`, resourceType: 'image', format: 'png', mimeType: 'image/png', sizeBytes: 24, width: 10, height: 10, checksumSha256: 'a'.repeat(64) } });
    await request(app).get(`/api/professional-onboarding/assets/${asset.id}/access`).set(bearer(owner.token)).expect(200);
    await request(app).delete(`/api/professional-onboarding/assets/${asset.id}`).set(bearer(owner.token)).send({ expectedRevision: 1 }).expect(409);
    await request(app).post('/api/professional-onboarding/assets').set(bearer(owner.token)).field('category', 'AVATAR').field('expectedRevision', '1').attach('file', png(), 'new.png').expect(409);
  });

  it('NEEDS_CHANGES puede subir sin ProfessionalAccess y snapshot es semántico, sin secretos de storage', async () => {
    const owner = await actor('snapshot');
    const profession = await prisma.healthProfession.create({ data: { code: `MED_UP_${sequence}`, name: `Med upload ${sequence}`, nameNormalized: `med upload ${sequence}` } });
    const appRecord = await prisma.professionalApplication.create({ data: { userId: owner.user.id, cycleNumber: 1, status: 'NEEDS_CHANGES', submittedAt: new Date(), legalGivenNames: 'Ana', legalFamilyNames: 'Pérez', primaryPhoneE164: '+593999999999', practiceCountryCode: 'EC', healthProfessionId: profession.id } });
    await prisma.professionalApplicationLocation.create({ data: { applicationId: appRecord.id, countryCode: 'EC', city: 'Quito', street1: 'Principal' } });
    const uploaded = await request(app).post('/api/professional-onboarding/assets').set(bearer(owner.token)).field('category', 'AVATAR').field('expectedRevision', '1').attach('file', png(), 'avatar.png').expect(201);
    await request(app).post('/api/professional-onboarding/submit').set(bearer(owner.token)).set('Idempotency-Key', 'upload-snapshot').send({ expectedRevision: uploaded.body.currentRevision }).expect(200);
    const snapshot = await prisma.professionalApplicationSnapshot.findFirstOrThrow();
    const serialized = JSON.stringify(snapshot.payload);
    expect(serialized).toContain(uploaded.body.asset.id);
    expect(serialized).not.toMatch(/publicId|cloudinary|temporary\.test|signature|api_secret|signed/i);
    expect(await prisma.professionalAccess.count()).toBe(0);
    expect(await prisma.doctorProfile.count()).toBe(0);
    expect(await prisma.userRoleAssignment.count({ where: { role: 'DOCTOR' } })).toBe(0);
  });
});
