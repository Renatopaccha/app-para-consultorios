import type { Prisma, PrismaClient } from '../../generated/prisma';

export const PROFESSIONAL_EVIDENCE_BACKFILL_CLASSIFICATIONS = [
  'v1_recoverable',
  'v1_unknown_binary',
  'v1_missing_binary',
  'v1_document_row_missing',
  'v1_metadata_mismatch',
  'v1_relation_mismatch',
] as const;

export type ProfessionalEvidenceBackfillClassification =
  typeof PROFESSIONAL_EVIDENCE_BACKFILL_CLASSIFICATIONS[number];

type ClassificationCounts = Record<ProfessionalEvidenceBackfillClassification, number>;

export interface ProfessionalEvidenceBackfillPlan {
  mode: 'PLAN';
  readOnly: true;
  applySupported: false;
  snapshotSchemaVersion: 1;
  snapshotsScanned: number;
  documentItemsScanned: number;
  snapshotClassifications: ClassificationCounts;
  documentClassifications: ClassificationCounts;
}

type BackfillReadClient = Pick<
  Prisma.TransactionClient,
  'professionalApplicationSnapshot' | 'professionalApplicationCredential' | 'credentialDocument'
>;

type SnapshotRow = {
  id: string;
  applicationId: string;
  revision: number;
  payload: Prisma.JsonValue;
};

type SnapshotDocument = {
  id: string;
  kind?: string;
  mimeType?: string;
  sizeBytes?: number;
  checksumSha256?: string;
  pageCount?: number | null;
  scanStatus?: string;
};

type SnapshotItem = {
  applicationId: string;
  credentialId: string;
  document: SnapshotDocument;
};

function emptyCounts(): ClassificationCounts {
  return Object.fromEntries(
    PROFESSIONAL_EVIDENCE_BACKFILL_CLASSIFICATIONS.map((code) => [code, 0]),
  ) as ClassificationCounts;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function snapshotItems(snapshot: SnapshotRow): SnapshotItem[] | null {
  if (!isRecord(snapshot.payload)) return null;
  const application = snapshot.payload.application;
  if (!isRecord(application) || application.id !== snapshot.applicationId) return null;
  if (!Array.isArray(application.credentials)) return null;

  const items: SnapshotItem[] = [];
  for (const rawCredential of application.credentials) {
    if (!isRecord(rawCredential) || typeof rawCredential.id !== 'string' || !Array.isArray(rawCredential.documents)) {
      return null;
    }
    for (const rawDocument of rawCredential.documents) {
      if (!isRecord(rawDocument) || typeof rawDocument.id !== 'string') return null;
      items.push({
        applicationId: snapshot.applicationId,
        credentialId: rawCredential.id,
        document: rawDocument as SnapshotDocument,
      });
    }
  }
  return items;
}

function expectedStorageMetadata(mimeType: string | undefined): { format: string; resourceType: string } | null {
  switch (mimeType) {
    case 'application/pdf': return { format: 'pdf', resourceType: 'raw' };
    case 'image/jpeg': return { format: 'jpg', resourceType: 'image' };
    case 'image/png': return { format: 'png', resourceType: 'image' };
    case 'image/webp': return { format: 'webp', resourceType: 'image' };
    default: return null;
  }
}

function itemMetadataMatches(
  item: SnapshotItem,
  row: {
    kind: string;
    mimeType: string;
    format: string;
    resourceType: string;
    sizeBytes: number;
    checksumSha256: string;
    pageCount: number | null;
  },
): boolean {
  const storage = expectedStorageMetadata(item.document.mimeType);
  return storage !== null
    && item.document.kind === row.kind
    && item.document.mimeType === row.mimeType
    && storage.format === row.format
    && storage.resourceType === row.resourceType
    && item.document.sizeBytes === row.sizeBytes
    && item.document.checksumSha256 === row.checksumSha256.trim()
    && (item.document.pageCount ?? null) === row.pageCount;
}

function addSnapshotClassifications(
  counts: ClassificationCounts,
  itemClassifications: Set<ProfessionalEvidenceBackfillClassification>,
): void {
  for (const classification of itemClassifications) counts[classification] += 1;
}

async function classifyBatch(
  client: BackfillReadClient,
  snapshots: SnapshotRow[],
  plan: ProfessionalEvidenceBackfillPlan,
): Promise<void> {
  const parsed = snapshots.map((snapshot) => ({ snapshot, items: snapshotItems(snapshot) }));
  const validItems = parsed.flatMap(({ items }) => items ?? []);
  const documentIds = [...new Set(validItems.map(({ document }) => document.id))];
  const credentialIds = [...new Set(validItems.map(({ credentialId }) => credentialId))];
  const applicationIds = [...new Set(validItems.map(({ applicationId }) => applicationId))];

  const [documents, links] = await Promise.all([
    documentIds.length ? client.credentialDocument.findMany({
      where: { id: { in: documentIds } },
      select: {
        id: true,
        credentialId: true,
        kind: true,
        storageProvider: true,
        publicId: true,
        resourceType: true,
        format: true,
        mimeType: true,
        sizeBytes: true,
        checksumSha256: true,
        pageCount: true,
        scanStatus: true,
        deletedAt: true,
      },
    }) : [],
    credentialIds.length && applicationIds.length ? client.professionalApplicationCredential.findMany({
      where: { applicationId: { in: applicationIds }, credentialId: { in: credentialIds } },
      select: {
        id: true,
        applicationId: true,
        credentialId: true,
        application: { select: { userId: true } },
        credential: { select: { userId: true } },
      },
    }) : [],
  ]);

  const documentById = new Map(documents.map((document) => [document.id, document]));
  const linkByPair = new Map(links.map((link) => [`${link.applicationId}\u0000${link.credentialId}`, link]));

  for (const { items } of parsed) {
    plan.snapshotsScanned += 1;
    const snapshotCodes = new Set<ProfessionalEvidenceBackfillClassification>();
    if (items === null || items.length === 0) {
      snapshotCodes.add('v1_metadata_mismatch');
      addSnapshotClassifications(plan.snapshotClassifications, snapshotCodes);
      continue;
    }

    const seenDocuments = new Set<string>();
    for (const item of items) {
      plan.documentItemsScanned += 1;
      const itemCodes = new Set<ProfessionalEvidenceBackfillClassification>();
      const document = documentById.get(item.document.id);
      const link = linkByPair.get(`${item.applicationId}\u0000${item.credentialId}`);

      if (seenDocuments.has(item.document.id)) itemCodes.add('v1_relation_mismatch');
      seenDocuments.add(item.document.id);

      if (!document) {
        itemCodes.add('v1_document_row_missing');
      } else if (!link || document.credentialId !== item.credentialId || link.application.userId !== link.credential.userId) {
        itemCodes.add('v1_relation_mismatch');
      } else if (!itemMetadataMatches(item, document)) {
        itemCodes.add('v1_metadata_mismatch');
      } else {
        itemCodes.add('v1_recoverable');
        // This planner never contacts Cloudinary. An active database locator is
        // recoverable semantically, but binary presence remains explicitly UNKNOWN.
        if (!document.storageProvider.trim() || !document.publicId.trim() || !document.resourceType.trim()) {
          itemCodes.add('v1_missing_binary');
        } else {
          itemCodes.add('v1_unknown_binary');
        }
      }

      for (const code of itemCodes) plan.documentClassifications[code] += 1;
      for (const code of itemCodes) snapshotCodes.add(code);
    }
    addSnapshotClassifications(plan.snapshotClassifications, snapshotCodes);
  }
}

export async function buildProfessionalEvidenceBackfillPlan(
  client: BackfillReadClient,
): Promise<ProfessionalEvidenceBackfillPlan> {
  const plan: ProfessionalEvidenceBackfillPlan = {
    mode: 'PLAN',
    readOnly: true,
    applySupported: false,
    snapshotSchemaVersion: 1,
    snapshotsScanned: 0,
    documentItemsScanned: 0,
    snapshotClassifications: emptyCounts(),
    documentClassifications: emptyCounts(),
  };

  const pageSize = 200;
  let cursor: string | undefined;
  do {
    const snapshots = await client.professionalApplicationSnapshot.findMany({
      where: { schemaVersion: 1 },
      orderBy: { id: 'asc' },
      take: pageSize,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      select: { id: true, applicationId: true, revision: true, payload: true },
    });
    if (!snapshots.length) break;
    await classifyBatch(client, snapshots, plan);
    cursor = snapshots.at(-1)!.id;
  } while (true);

  return plan;
}

export async function planProfessionalEvidenceBackfill(
  client: PrismaClient,
): Promise<ProfessionalEvidenceBackfillPlan> {
  return client.$transaction(async (tx) => {
    await tx.$executeRawUnsafe('SET TRANSACTION READ ONLY');
    return buildProfessionalEvidenceBackfillPlan(tx);
  }, { isolationLevel: 'RepeatableRead' });
}

export function formatProfessionalEvidenceBackfillPlan(plan: ProfessionalEvidenceBackfillPlan): string {
  const lines = [
    'Professional evidence backfill PLAN (read-only; APPLY is not supported)',
    `snapshotSchemaVersion: ${plan.snapshotSchemaVersion}`,
    `snapshotsScanned: ${plan.snapshotsScanned}`,
    `documentItemsScanned: ${plan.documentItemsScanned}`,
    'snapshotClassifications:',
    ...PROFESSIONAL_EVIDENCE_BACKFILL_CLASSIFICATIONS.map((code) => `  ${code}: ${plan.snapshotClassifications[code]}`),
    'documentClassifications:',
    ...PROFESSIONAL_EVIDENCE_BACKFILL_CLASSIFICATIONS.map((code) => `  ${code}: ${plan.documentClassifications[code]}`),
  ];
  return lines.join('\n');
}
