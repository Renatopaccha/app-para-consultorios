import { ApplicationAssetCategory, CredentialDocumentKind, Prisma } from '../../generated/prisma';
import prisma from '../prisma';
import { ProfessionalOnboardingError } from './professionalOnboarding.service';
import {
  deleteOnboardingFile,
  OnboardingStorageError,
  temporaryOnboardingFileUrl,
  uploadOnboardingCredentialDocument,
  uploadOnboardingImage,
} from './professionalOnboardingStorage.service';

const EDITABLE = ['DRAFT', 'NEEDS_CHANGES'] as const;

function parseRevision(value: unknown): number {
  const parsed = typeof value === 'string' && /^\d+$/.test(value) ? Number(value) : value;
  if (!Number.isInteger(parsed) || Number(parsed) < 1) throw new ProfessionalOnboardingError('PROFESSIONAL_ONBOARDING_INPUT_INVALID', 422, 'expectedRevision debe ser un entero positivo.', { fields: ['expectedRevision'] });
  return Number(parsed);
}

function parseSortOrder(value: unknown): number | undefined {
  if (value === undefined || value === '') return undefined;
  const parsed = typeof value === 'string' && /^\d+$/.test(value) ? Number(value) : value;
  if (!Number.isInteger(parsed) || Number(parsed) < 0) throw new ProfessionalOnboardingError('PROFESSIONAL_ONBOARDING_INPUT_INVALID', 422, 'sortOrder debe ser un entero no negativo.', { fields: ['sortOrder'] });
  return Number(parsed);
}

async function lockActiveApplication(tx: Prisma.TransactionClient, userId: string) {
  const rows = await tx.$queryRaw<Array<{ id: string }>>`
    SELECT "id" FROM "ProfessionalApplication"
    WHERE "userId" = ${userId} AND "status" IN ('DRAFT', 'PENDING_REVIEW', 'NEEDS_CHANGES')
    ORDER BY "cycleNumber" DESC LIMIT 1 FOR UPDATE
  `;
  if (!rows[0]) {
    const historical = await tx.professionalApplication.findFirst({ where: { userId }, orderBy: { cycleNumber: 'desc' }, select: { id: true } });
    if (historical) throw new ProfessionalOnboardingError('PROFESSIONAL_APPLICATION_NOT_EDITABLE', 409, 'La solicitud no está disponible para modificar archivos.');
    throw new ProfessionalOnboardingError('PROFESSIONAL_APPLICATION_NOT_FOUND', 404, 'No existe una solicitud profesional activa.');
  }
  return tx.professionalApplication.findUniqueOrThrow({ where: { id: rows[0].id } });
}

function assertEditable(application: { status: string; currentRevision: number }, expected: number) {
  if (!(EDITABLE as readonly string[]).includes(application.status)) {
    throw new ProfessionalOnboardingError(application.status === 'PENDING_REVIEW' ? 'PROFESSIONAL_APPLICATION_ALREADY_PENDING' : 'PROFESSIONAL_APPLICATION_NOT_EDITABLE', 409, 'La solicitud no está disponible para modificar archivos.');
  }
  if (application.currentRevision !== expected) throw new ProfessionalOnboardingError('PROFESSIONAL_APPLICATION_CONFLICT', 409, 'La solicitud cambió en otra sesión. Recarga antes de continuar.');
}

async function preflight(userId: string, expected: number) {
  const application = await prisma.professionalApplication.findFirst({ where: { userId, status: { in: ['DRAFT', 'PENDING_REVIEW', 'NEEDS_CHANGES'] } } });
  if (!application) {
    const historical = await prisma.professionalApplication.findFirst({ where: { userId }, select: { id: true } });
    if (historical) throw new ProfessionalOnboardingError('PROFESSIONAL_APPLICATION_NOT_EDITABLE', 409, 'La solicitud no está disponible para modificar archivos.');
    throw new ProfessionalOnboardingError('PROFESSIONAL_APPLICATION_NOT_FOUND', 404, 'No existe una solicitud profesional activa.');
  }
  assertEditable(application, expected);
  return application;
}

function assetDto(asset: { id: string; category: ApplicationAssetCategory; mimeType: string; sizeBytes: number; width: number; height: number; checksumSha256: string; sortOrder: number; moderationStatus: string; createdAt: Date }) {
  return {
    id: asset.id, category: asset.category, mimeType: asset.mimeType, sizeBytes: asset.sizeBytes,
    width: asset.width, height: asset.height, checksumSha256: asset.checksumSha256,
    sortOrder: asset.sortOrder, moderationStatus: asset.moderationStatus, createdAt: asset.createdAt,
  };
}

function documentDto(document: { id: string; kind: CredentialDocumentKind; mimeType: string; sizeBytes: number; checksumSha256: string; pageCount: number | null; scanStatus: string; scannedAt: Date | null; createdAt: Date }) {
  return {
    id: document.id, kind: document.kind, mimeType: document.mimeType, sizeBytes: document.sizeBytes,
    checksumSha256: document.checksumSha256, pageCount: document.pageCount,
    scanStatus: document.scanStatus, scannedAt: document.scannedAt, createdAt: document.createdAt,
  };
}

export async function createApplicationAsset(userId: string, input: { category: unknown; sortOrder?: unknown; expectedRevision: unknown }, file?: Express.Multer.File) {
  if (!file) throw new OnboardingStorageError('UPLOAD_REQUIRED', 'Debes adjuntar un archivo.');
  if (!Object.values(ApplicationAssetCategory).includes(input.category as ApplicationAssetCategory)) throw new ProfessionalOnboardingError('PROFESSIONAL_ONBOARDING_INPUT_INVALID', 422, 'category no es válida.', { fields: ['category'] });
  const category = input.category as ApplicationAssetCategory;
  const expected = parseRevision(input.expectedRevision);
  const requestedOrder = parseSortOrder(input.sortOrder);
  const application = await preflight(userId, expected);
  const stored = await uploadOnboardingImage(file.buffer, file.mimetype, application.id, category);
  try {
    const result = await prisma.$transaction(async (tx) => {
      const locked = await lockActiveApplication(tx, userId);
      assertEditable(locked, expected);
      let sortOrder = category === 'AVATAR' ? 0 : requestedOrder;
      if (sortOrder === undefined) {
        const maximum = await tx.professionalApplicationAsset.aggregate({ where: { applicationId: locked.id, category, deletedAt: null }, _max: { sortOrder: true } });
        sortOrder = (maximum._max.sortOrder ?? -1) + 1;
      }
      const previousAvatar = category === 'AVATAR'
        ? await tx.professionalApplicationAsset.findFirst({ where: { applicationId: locked.id, category: 'AVATAR', deletedAt: null } })
        : null;
      if (previousAvatar) await tx.professionalApplicationAsset.update({ where: { id: previousAvatar.id }, data: { deletedAt: new Date() } });
      const asset = await tx.professionalApplicationAsset.create({ data: {
        applicationId: locked.id, category, sortOrder,
        storageProvider: stored.storageProvider, publicId: stored.publicId, resourceType: stored.resourceType,
        format: stored.format, mimeType: stored.mimeType, sizeBytes: stored.sizeBytes,
        width: stored.width!, height: stored.height!, checksumSha256: stored.checksumSha256,
        moderationStatus: 'PENDING',
      } });
      const updated = await tx.professionalApplication.update({ where: { id: locked.id }, data: { currentRevision: { increment: 1 } } });
      return { asset: assetDto(asset), currentRevision: updated.currentRevision, previousAvatar };
    });
    if (result.previousAvatar) void deleteOnboardingFile(result.previousAvatar).catch(() => undefined);
    return { asset: result.asset, currentRevision: result.currentRevision };
  } catch (error) {
    void deleteOnboardingFile(stored).catch(() => undefined);
    throw error;
  }
}

async function ownedCredentialForActiveApplication(userId: string, credentialId: string) {
  const link = await prisma.professionalApplicationCredential.findFirst({
    where: { credentialId, application: { userId, status: { in: ['DRAFT', 'PENDING_REVIEW', 'NEEDS_CHANGES'] } }, credential: { userId, deletedAt: null } },
    include: { application: true },
  });
  if (!link) throw new ProfessionalOnboardingError('PROFESSIONAL_CREDENTIAL_OWNERSHIP_MISMATCH', 404, 'La credencial no pertenece a esta solicitud.');
  return link;
}

export async function createCredentialDocument(userId: string, credentialId: string, input: { kind?: unknown; expectedRevision: unknown }, file?: Express.Multer.File) {
  if (!file) throw new OnboardingStorageError('UPLOAD_REQUIRED', 'Debes adjuntar un archivo.');
  const kind = input.kind === undefined ? 'PRIMARY_EVIDENCE' : input.kind;
  if (!Object.values(CredentialDocumentKind).includes(kind as CredentialDocumentKind)) throw new ProfessionalOnboardingError('PROFESSIONAL_ONBOARDING_INPUT_INVALID', 422, 'kind no es válido.', { fields: ['kind'] });
  const expected = parseRevision(input.expectedRevision);
  const link = await ownedCredentialForActiveApplication(userId, credentialId);
  assertEditable(link.application, expected);
  const stored = await uploadOnboardingCredentialDocument(file.buffer, file.mimetype, link.applicationId, credentialId);
  try {
    return await prisma.$transaction(async (tx) => {
      const application = await lockActiveApplication(tx, userId);
      assertEditable(application, expected);
      const owned = await tx.professionalApplicationCredential.findUnique({ where: { applicationId_credentialId: { applicationId: application.id, credentialId } }, include: { credential: { select: { userId: true, deletedAt: true } } } });
      if (!owned || owned.credential.userId !== userId || owned.credential.deletedAt) throw new ProfessionalOnboardingError('PROFESSIONAL_CREDENTIAL_OWNERSHIP_MISMATCH', 404, 'La credencial no pertenece a esta solicitud.');
      const document = await tx.credentialDocument.create({ data: {
        credentialId, kind: kind as CredentialDocumentKind,
        storageProvider: stored.storageProvider, publicId: stored.publicId, resourceType: stored.resourceType,
        format: stored.format, mimeType: stored.mimeType, sizeBytes: stored.sizeBytes,
        checksumSha256: stored.checksumSha256, pageCount: stored.pageCount,
        scanStatus: 'PENDING', scannedAt: null,
      } });
      const updated = await tx.professionalApplication.update({ where: { id: application.id }, data: { currentRevision: { increment: 1 } } });
      return { document: documentDto(document), currentRevision: updated.currentRevision };
    });
  } catch (error) {
    void deleteOnboardingFile(stored).catch(() => undefined);
    throw error;
  }
}

export async function accessApplicationAsset(userId: string, assetId: string) {
  const asset = await prisma.professionalApplicationAsset.findFirst({
    where: { id: assetId, deletedAt: null, application: { userId } },
    select: { publicId: true, format: true, resourceType: true },
  });
  if (!asset) throw new ProfessionalOnboardingError('PROFESSIONAL_APPLICATION_NOT_FOUND', 404, 'Archivo no encontrado.');
  return temporaryOnboardingFileUrl(asset);
}

export async function accessCredentialDocument(userId: string, credentialId: string, documentId: string) {
  const document = await prisma.credentialDocument.findFirst({
    where: { id: documentId, credentialId, deletedAt: null, credential: { userId, deletedAt: null, applications: { some: { application: { userId } } } } },
    select: { publicId: true, format: true, resourceType: true },
  });
  if (!document) throw new ProfessionalOnboardingError('PROFESSIONAL_CREDENTIAL_OWNERSHIP_MISMATCH', 404, 'Documento no encontrado.');
  return temporaryOnboardingFileUrl(document);
}

export async function softDeleteApplicationAsset(userId: string, assetId: string, rawRevision: unknown) {
  const expected = parseRevision(rawRevision);
  const result = await prisma.$transaction(async (tx) => {
    const application = await lockActiveApplication(tx, userId);
    assertEditable(application, expected);
    const asset = await tx.professionalApplicationAsset.findFirst({ where: { id: assetId, applicationId: application.id, deletedAt: null } });
    if (!asset) throw new ProfessionalOnboardingError('PROFESSIONAL_APPLICATION_NOT_FOUND', 404, 'Archivo no encontrado.');
    await tx.professionalApplicationAsset.update({ where: { id: asset.id }, data: { deletedAt: new Date() } });
    const updated = await tx.professionalApplication.update({ where: { id: application.id }, data: { currentRevision: { increment: 1 } } });
    return { file: asset, currentRevision: updated.currentRevision };
  });
  void deleteOnboardingFile(result.file).catch(() => undefined);
  return { deleted: true, currentRevision: result.currentRevision };
}

export async function softDeleteCredentialDocument(userId: string, credentialId: string, documentId: string, rawRevision: unknown) {
  const expected = parseRevision(rawRevision);
  const result = await prisma.$transaction(async (tx) => {
    const application = await lockActiveApplication(tx, userId);
    assertEditable(application, expected);
    const document = await tx.credentialDocument.findFirst({ where: {
      id: documentId, credentialId, deletedAt: null,
      credential: { userId, deletedAt: null, applications: { some: { applicationId: application.id } } },
    } });
    if (!document) throw new ProfessionalOnboardingError('PROFESSIONAL_CREDENTIAL_OWNERSHIP_MISMATCH', 404, 'Documento no encontrado.');
    await tx.credentialDocument.update({ where: { id: document.id }, data: { deletedAt: new Date() } });
    const updated = await tx.professionalApplication.update({ where: { id: application.id }, data: { currentRevision: { increment: 1 } } });
    return { file: document, currentRevision: updated.currentRevision };
  });
  void deleteOnboardingFile(result.file).catch(() => undefined);
  return { deleted: true, currentRevision: result.currentRevision };
}

export async function reorderPracticeAssets(userId: string, input: { expectedRevision: unknown; items?: Array<{ assetId?: unknown; sortOrder?: unknown }> }) {
  const expected = parseRevision(input.expectedRevision);
  if (!Array.isArray(input.items) || !input.items.length) throw new ProfessionalOnboardingError('PROFESSIONAL_ONBOARDING_INPUT_INVALID', 422, 'items debe contener el orden de las fotos.', { fields: ['items'] });
  const items = input.items.map((item) => {
    if (typeof item.assetId !== 'string' || !item.assetId) throw new ProfessionalOnboardingError('PROFESSIONAL_ONBOARDING_INPUT_INVALID', 422, 'assetId no es válido.', { fields: ['items'] });
    return { assetId: item.assetId, sortOrder: parseSortOrder(item.sortOrder) };
  });
  if (items.some(({ sortOrder }) => sortOrder === undefined) || new Set(items.map(({ assetId }) => assetId)).size !== items.length || new Set(items.map(({ sortOrder }) => sortOrder)).size !== items.length) {
    throw new ProfessionalOnboardingError('PROFESSIONAL_ONBOARDING_INPUT_INVALID', 422, 'Los assets y posiciones deben ser únicos.', { fields: ['items'] });
  }
  return prisma.$transaction(async (tx) => {
    const application = await lockActiveApplication(tx, userId);
    assertEditable(application, expected);
    const assets = await tx.professionalApplicationAsset.findMany({ where: { applicationId: application.id, id: { in: items.map(({ assetId }) => assetId) }, category: { in: ['PRACTICE_INTERIOR', 'PRACTICE_EXTERIOR'] }, deletedAt: null } });
    if (assets.length !== items.length) throw new ProfessionalOnboardingError('PROFESSIONAL_APPLICATION_NOT_FOUND', 404, 'Una foto no pertenece a la solicitud.');
    const byId = new Map(assets.map((asset) => [asset.id, asset]));
    const maximum = await tx.professionalApplicationAsset.aggregate({ where: { applicationId: application.id, deletedAt: null }, _max: { sortOrder: true } });
    const temporaryBase = (maximum._max.sortOrder ?? 0) + items.length + 1;
    for (const [index, item] of items.entries()) await tx.professionalApplicationAsset.update({ where: { id: item.assetId }, data: { sortOrder: temporaryBase + index } });
    for (const item of items) {
      const asset = byId.get(item.assetId)!;
      const collision = await tx.professionalApplicationAsset.count({ where: { applicationId: application.id, category: asset.category, sortOrder: item.sortOrder!, deletedAt: null, id: { not: asset.id } } });
      if (collision) throw new ProfessionalOnboardingError('PROFESSIONAL_APPLICATION_CONFLICT', 409, 'La posición ya está ocupada por otra foto.');
      await tx.professionalApplicationAsset.update({ where: { id: asset.id }, data: { sortOrder: item.sortOrder! } });
    }
    const updated = await tx.professionalApplication.update({ where: { id: application.id }, data: { currentRevision: { increment: 1 } } });
    return { items: await tx.professionalApplicationAsset.findMany({ where: { applicationId: application.id, category: { in: ['PRACTICE_INTERIOR', 'PRACTICE_EXTERIOR'] }, deletedAt: null }, orderBy: [{ category: 'asc' }, { sortOrder: 'asc' }], select: { id: true, category: true, sortOrder: true } }), currentRevision: updated.currentRevision };
  });
}
