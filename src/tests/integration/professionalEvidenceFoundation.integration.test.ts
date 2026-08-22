import prisma, { disconnectPrisma } from '../../prisma';
import {
  formatProfessionalEvidenceBackfillPlan,
  planProfessionalEvidenceBackfill,
} from '../../services/professionalEvidenceBackfillPlan.service';
import { clearIntegrationDatabase } from './testDatabase';

let sequence = 0;
const HASH = 'b'.repeat(64);

async function user(label: string) {
  sequence += 1;
  const email = `${label}.${sequence}@evidence-foundation.zenda.test`;
  return prisma.user.create({ data: {
    firstName: 'Evidence', lastName: 'Fixture', email, emailNormalized: email,
  } });
}

async function foundationFixture() {
  const owner = await user('owner');
  const application = await prisma.professionalApplication.create({ data: {
    userId: owner.id,
    cycleNumber: 1,
    status: 'PENDING_REVIEW',
    currentRevision: 2,
    submittedAt: new Date(),
  } });
  const credential = await prisma.professionalCredential.create({ data: {
    userId: owner.id,
    credentialType: 'PRIMARY_DEGREE',
    countryCode: 'EC',
    exactTitle: 'Título de prueba',
    institutionNameSnapshot: 'Institución de prueba',
  } });
  const link = await prisma.professionalApplicationCredential.create({ data: {
    applicationId: application.id,
    credentialId: credential.id,
    isPrimary: true,
  } });
  const document = await prisma.credentialDocument.create({ data: {
    credentialId: credential.id,
    kind: 'PRIMARY_EVIDENCE',
    storageProvider: 'cloudinary',
    publicId: `private/document-${sequence}`,
    resourceType: 'raw',
    format: 'pdf',
    mimeType: 'application/pdf',
    sizeBytes: 512,
    checksumSha256: HASH,
    pageCount: 1,
    scanStatus: 'PENDING',
  } });
  const payload = {
    schemaVersion: 1,
    revision: 2,
    application: {
      id: application.id,
      credentials: [{
        id: credential.id,
        documents: [{
          id: document.id,
          kind: document.kind,
          mimeType: document.mimeType,
          sizeBytes: document.sizeBytes,
          checksumSha256: document.checksumSha256,
          pageCount: document.pageCount,
          scanStatus: document.scanStatus,
        }],
      }],
    },
  };
  const snapshot = await prisma.professionalApplicationSnapshot.create({ data: {
    applicationId: application.id,
    revision: 2,
    schemaVersion: 1,
    payload,
    payloadHash: 'c'.repeat(64),
  } });
  const reviewLog = await prisma.professionalApplicationReviewLog.create({ data: {
    applicationId: application.id,
    snapshotId: snapshot.id,
    actorUserId: owner.id,
    action: 'SUBMITTED',
    previousStatus: 'DRAFT',
    newStatus: 'PENDING_REVIEW',
    idempotencyKey: `evidence-fixture-${sequence}`,
  } });
  return { owner, application, credential, link, document, snapshot, reviewLog };
}

function evidenceData(fixture: Awaited<ReturnType<typeof foundationFixture>>) {
  return {
    applicationId: fixture.application.id,
    applicantUserId: fixture.owner.id,
    snapshotId: fixture.snapshot.id,
    snapshotRevision: fixture.snapshot.revision,
    applicationCredentialId: fixture.link.id,
    credentialId: fixture.credential.id,
    credentialDocumentId: fixture.document.id,
    evidenceType: fixture.document.kind,
    mimeType: fixture.document.mimeType,
    format: fixture.document.format,
    resourceType: fixture.document.resourceType,
    sizeBytes: fixture.document.sizeBytes,
    pageCount: fixture.document.pageCount,
    width: fixture.document.width,
    height: fixture.document.height,
    checksumSha256: fixture.document.checksumSha256,
    scanStatusAtSubmit: fixture.document.scanStatus,
    captureSource: 'BACKFILL_V1' as const,
  };
}

beforeEach(clearIntegrationDatabase);
afterAll(disconnectPrisma);

describe('professional evidence foundation DB', () => {
  it('crea evidencia/retención/evento y conserva defaults sin tratar PENDING como CLEAN', async () => {
    const fixture = await foundationFixture();
    const evidence = await prisma.professionalApplicationCredentialDocumentEvidence.create({ data: evidenceData(fixture) });
    const retention = await prisma.professionalEvidenceRetention.create({ data: { evidenceId: evidence.id } });
    const event = await prisma.professionalEvidenceRetentionEvent.create({ data: {
      evidenceId: evidence.id,
      action: 'HOLD_CREATED',
      previousStatus: null,
      newStatus: 'HELD',
      idempotencyKey: `hold-${sequence}`,
    } });

    expect(evidence).toMatchObject({ scanStatusAtSubmit: 'PENDING', captureSource: 'BACKFILL_V1' });
    expect(retention).toMatchObject({ status: 'HELD', binaryStatus: 'PRESENT', version: 1 });
    expect(event).toMatchObject({ action: 'HOLD_CREATED', newStatus: 'HELD' });
  });

  it('rechaza cruces de usuario/solicitud y metadata físicamente inválida', async () => {
    const fixture = await foundationFixture();
    const outsider = await user('outsider');

    await expect(prisma.professionalApplicationCredentialDocumentEvidence.create({
      data: { ...evidenceData(fixture), applicantUserId: outsider.id },
    })).rejects.toThrow();
    await expect(prisma.professionalApplicationCredentialDocumentEvidence.create({
      data: { ...evidenceData(fixture), snapshotRevision: fixture.snapshot.revision + 1 },
    })).rejects.toThrow();
    await expect(prisma.professionalApplicationCredentialDocumentEvidence.create({
      data: { ...evidenceData(fixture), sizeBytes: 0 },
    })).rejects.toThrow();
    await expect(prisma.professionalApplicationCredentialDocumentEvidence.create({
      data: { ...evidenceData(fixture), checksumSha256: 'not-a-sha256' },
    })).rejects.toThrow();
    await expect(prisma.professionalApplicationCredentialDocumentEvidence.create({
      data: { ...evidenceData(fixture), width: 100, height: null },
    })).rejects.toThrow();
    await expect(prisma.credentialDocument.create({ data: {
      credentialId: fixture.credential.id,
      storageProvider: 'cloudinary', publicId: `bad-dimensions-${sequence}`,
      resourceType: 'image', format: 'png', mimeType: 'image/png', sizeBytes: 10,
      checksumSha256: HASH, width: 100, height: null,
    } })).rejects.toThrow();
  });

  it('impone unicidad por snapshot/documento pero permite reutilizarlo en otro snapshot', async () => {
    const fixture = await foundationFixture();
    await prisma.professionalApplicationCredentialDocumentEvidence.create({ data: evidenceData(fixture) });
    await expect(prisma.professionalApplicationCredentialDocumentEvidence.create({ data: evidenceData(fixture) })).rejects.toThrow();

    const secondSnapshot = await prisma.professionalApplicationSnapshot.create({ data: {
      applicationId: fixture.application.id,
      revision: 3,
      schemaVersion: 1,
      payload: fixture.snapshot.payload!,
      payloadHash: 'd'.repeat(64),
    } });
    await expect(prisma.professionalApplicationCredentialDocumentEvidence.create({ data: {
      ...evidenceData(fixture),
      snapshotId: secondSnapshot.id,
      snapshotRevision: secondSnapshot.revision,
    } })).resolves.toMatchObject({ credentialDocumentId: fixture.document.id });
  });

  it('bloquea UPDATE/DELETE histórico y protege metadata del documento evidenciado', async () => {
    const fixture = await foundationFixture();
    const evidence = await prisma.professionalApplicationCredentialDocumentEvidence.create({ data: evidenceData(fixture) });
    await prisma.professionalEvidenceRetention.create({ data: { evidenceId: evidence.id } });
    const event = await prisma.professionalEvidenceRetentionEvent.create({ data: {
      evidenceId: evidence.id, action: 'HOLD_CREATED', newStatus: 'HELD', idempotencyKey: `immutability-${sequence}`,
    } });

    await expect(prisma.professionalApplicationCredentialDocumentEvidence.update({ where: { id: evidence.id }, data: { includedAt: new Date() } })).rejects.toThrow(/append-only/);
    await expect(prisma.professionalApplicationCredentialDocumentEvidence.delete({ where: { id: evidence.id } })).rejects.toThrow(/append-only/);
    await expect(prisma.professionalApplicationSnapshot.update({ where: { id: fixture.snapshot.id }, data: { payloadHash: 'e'.repeat(64) } })).rejects.toThrow(/append-only/);
    await expect(prisma.professionalApplicationSnapshot.delete({ where: { id: fixture.snapshot.id } })).rejects.toThrow(/append-only/);
    await expect(prisma.professionalApplicationReviewLog.update({ where: { id: fixture.reviewLog.id }, data: { requestId: 'changed' } })).rejects.toThrow(/append-only/);
    await expect(prisma.professionalApplicationReviewLog.delete({ where: { id: fixture.reviewLog.id } })).rejects.toThrow(/append-only/);
    await expect(prisma.professionalEvidenceRetentionEvent.update({ where: { id: event.id }, data: { requestId: 'changed' } })).rejects.toThrow(/append-only/);
    await expect(prisma.professionalEvidenceRetentionEvent.delete({ where: { id: event.id } })).rejects.toThrow(/append-only/);

    await expect(prisma.credentialDocument.update({ where: { id: fixture.document.id }, data: { mimeType: 'image/png' } })).rejects.toThrow(/immutable evidence metadata/);
    await expect(prisma.credentialDocument.delete({ where: { id: fixture.document.id } })).rejects.toThrow();
    await expect(prisma.credentialDocument.update({ where: { id: fixture.document.id }, data: {
      scanStatus: 'CLEAN', scannedAt: new Date(), deletedAt: new Date(),
    } })).resolves.toMatchObject({ scanStatus: 'CLEAN', deletedAt: expect.any(Date) });
    expect(await prisma.professionalApplicationCredentialDocumentEvidence.count({ where: { id: evidence.id } })).toBe(1);
  });

  it('mantiene libre el flujo de documentos sin evidencia y valida consistencia de retención', async () => {
    const fixture = await foundationFixture();
    await expect(prisma.credentialDocument.update({ where: { id: fixture.document.id }, data: {
      mimeType: 'image/png', format: 'png', resourceType: 'image', deletedAt: new Date(),
    } })).resolves.toMatchObject({ mimeType: 'image/png', deletedAt: expect.any(Date) });

    const evidence = await prisma.professionalApplicationCredentialDocumentEvidence.create({ data: {
      ...evidenceData(fixture), mimeType: 'image/png', format: 'png', resourceType: 'image',
    } });
    await expect(prisma.professionalEvidenceRetention.create({ data: {
      evidenceId: evidence.id, status: 'RELEASED',
    } })).rejects.toThrow();
    await expect(prisma.professionalEvidenceRetention.create({ data: {
      evidenceId: evidence.id,
      status: 'RELEASE_ELIGIBLE',
      releaseEligibleAt: new Date(),
      version: 0,
    } })).rejects.toThrow();
  });

  it('PLAN v1 es read-only, agregado y no expone IDs, hashes ni storage', async () => {
    const fixture = await foundationFixture();
    const before = {
      evidence: await prisma.professionalApplicationCredentialDocumentEvidence.count(),
      retention: await prisma.professionalEvidenceRetention.count(),
      events: await prisma.professionalEvidenceRetentionEvent.count(),
      documents: await prisma.credentialDocument.count(),
      snapshots: await prisma.professionalApplicationSnapshot.count(),
    };
    const plan = await planProfessionalEvidenceBackfill(prisma);
    const after = {
      evidence: await prisma.professionalApplicationCredentialDocumentEvidence.count(),
      retention: await prisma.professionalEvidenceRetention.count(),
      events: await prisma.professionalEvidenceRetentionEvent.count(),
      documents: await prisma.credentialDocument.count(),
      snapshots: await prisma.professionalApplicationSnapshot.count(),
    };
    const output = `${formatProfessionalEvidenceBackfillPlan(plan)}\n${JSON.stringify(plan)}`;

    expect(after).toEqual(before);
    expect(plan.documentClassifications).toMatchObject({ v1_recoverable: 1, v1_unknown_binary: 1 });
    for (const secret of [
      fixture.owner.id, fixture.application.id, fixture.credential.id, fixture.document.id,
      fixture.snapshot.id, fixture.document.publicId, fixture.document.checksumSha256,
    ]) expect(output).not.toContain(secret);
  });
});
