import {
  buildProfessionalEvidenceBackfillPlan,
  formatProfessionalEvidenceBackfillPlan,
  planProfessionalEvidenceBackfill,
} from './professionalEvidenceBackfillPlan.service';

const HASH = 'a'.repeat(64);

function validSnapshot() {
  return {
    id: 'snapshot-secret-id',
    applicationId: 'application-secret-id',
    revision: 2,
    payload: {
      application: {
        id: 'application-secret-id',
        credentials: [{
          id: 'credential-secret-id',
          documents: [{
            id: 'document-secret-id',
            kind: 'PRIMARY_EVIDENCE',
            mimeType: 'application/pdf',
            sizeBytes: 100,
            checksumSha256: HASH,
            pageCount: 1,
            scanStatus: 'PENDING',
          }],
        }],
      },
    },
  };
}

function client(input?: { document?: Record<string, unknown>; link?: Record<string, unknown>; payload?: unknown }) {
  const snapshot = validSnapshot();
  if (input?.payload !== undefined) snapshot.payload = input.payload as typeof snapshot.payload;
  return {
    professionalApplicationSnapshot: {
      findMany: jest.fn().mockResolvedValueOnce([snapshot]).mockResolvedValueOnce([]),
    },
    credentialDocument: {
      findMany: jest.fn().mockResolvedValue(input?.document === undefined ? [{
        id: 'document-secret-id', credentialId: 'credential-secret-id', kind: 'PRIMARY_EVIDENCE',
        storageProvider: 'cloudinary', publicId: 'private-storage-secret', resourceType: 'raw',
        format: 'pdf', mimeType: 'application/pdf', sizeBytes: 100, checksumSha256: HASH,
        pageCount: 1, scanStatus: 'PENDING', deletedAt: null,
      }] : [input.document]),
    },
    professionalApplicationCredential: {
      findMany: jest.fn().mockResolvedValue(input?.link === undefined ? [{
        id: 'application-credential-secret-id', applicationId: 'application-secret-id',
        credentialId: 'credential-secret-id', application: { userId: 'user-secret-id' },
        credential: { userId: 'user-secret-id' },
      }] : [input.link]),
    },
  };
}

describe('professional evidence backfill PLAN', () => {
  it('clasifica huella v1 recuperable sin afirmar que el binario está presente', async () => {
    const plan = await buildProfessionalEvidenceBackfillPlan(client() as never);
    expect(plan).toMatchObject({ mode: 'PLAN', readOnly: true, applySupported: false, snapshotsScanned: 1, documentItemsScanned: 1 });
    expect(plan.documentClassifications.v1_recoverable).toBe(1);
    expect(plan.documentClassifications.v1_unknown_binary).toBe(1);
    expect(plan.documentClassifications.v1_missing_binary).toBe(0);
  });

  it('conserva scanStatusAtSubmit del snapshot aunque el estado operativo ya sea CLEAN', async () => {
    const fixture = client();
    fixture.credentialDocument.findMany.mockReset().mockResolvedValue([{
      id: 'document-secret-id', credentialId: 'credential-secret-id', kind: 'PRIMARY_EVIDENCE',
      storageProvider: 'cloudinary', publicId: 'private-storage-secret', resourceType: 'raw',
      format: 'pdf', mimeType: 'application/pdf', sizeBytes: 100, checksumSha256: HASH,
      pageCount: 1, scanStatus: 'CLEAN', deletedAt: null,
    }]);
    const plan = await buildProfessionalEvidenceBackfillPlan(fixture as never);
    expect(plan.documentClassifications.v1_recoverable).toBe(1);
    expect(plan.documentClassifications.v1_metadata_mismatch).toBe(0);
  });

  it('distingue fila ausente, metadata inconsistente y relación cruzada', async () => {
    const missing = client();
    missing.credentialDocument.findMany.mockResolvedValue([]);
    expect((await buildProfessionalEvidenceBackfillPlan(missing as never)).documentClassifications.v1_document_row_missing).toBe(1);

    const metadata = client({ document: {
      id: 'document-secret-id', credentialId: 'credential-secret-id', kind: 'PRIMARY_EVIDENCE',
      storageProvider: 'cloudinary', publicId: 'private', resourceType: 'raw', format: 'pdf',
      mimeType: 'application/pdf', sizeBytes: 101, checksumSha256: HASH, pageCount: 1,
      scanStatus: 'PENDING', deletedAt: null,
    } });
    expect((await buildProfessionalEvidenceBackfillPlan(metadata as never)).documentClassifications.v1_metadata_mismatch).toBe(1);

    const relation = client({ link: {
      id: 'link', applicationId: 'application-secret-id', credentialId: 'credential-secret-id',
      application: { userId: 'owner-a' }, credential: { userId: 'owner-b' },
    } });
    expect((await buildProfessionalEvidenceBackfillPlan(relation as never)).documentClassifications.v1_relation_mismatch).toBe(1);
  });

  it('ejecuta dentro de una transacción READ ONLY y no ofrece modo apply', async () => {
    const tx = { ...client(), $executeRawUnsafe: jest.fn().mockResolvedValue(0) };
    const prisma = {
      $transaction: jest.fn(async (callback: (value: typeof tx) => unknown) => callback(tx)),
    };
    const plan = await planProfessionalEvidenceBackfill(prisma as never);
    expect(tx.$executeRawUnsafe).toHaveBeenCalledWith('SET TRANSACTION READ ONLY');
    expect(plan.applySupported).toBe(false);
    expect(Object.keys(tx)).not.toEqual(expect.arrayContaining(['create', 'update', 'delete', 'upsert']));
  });

  it('la salida humana y JSON contienen solo agregados, nunca secretos', async () => {
    const plan = await buildProfessionalEvidenceBackfillPlan(client() as never);
    const outputs = [formatProfessionalEvidenceBackfillPlan(plan), JSON.stringify(plan)];
    for (const output of outputs) {
      expect(output).not.toContain('snapshot-secret-id');
      expect(output).not.toContain('application-secret-id');
      expect(output).not.toContain('credential-secret-id');
      expect(output).not.toContain('document-secret-id');
      expect(output).not.toContain('private-storage-secret');
      expect(output).not.toContain(HASH);
      expect(output).toContain('v1_recoverable');
    }
  });
});
