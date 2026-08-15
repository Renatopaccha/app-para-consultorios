import { createHash } from 'crypto';
import {
  Prisma,
  ProfessionalApplicationStatus,
  ProfessionalCredentialType,
  LocationPrecision,
} from '../../generated/prisma';
import prisma from '../prisma';
import type {
  CredentialWriteDto,
  IdentityAutosaveDto,
  LocationAutosaveDto,
  ProfileAutosaveDto,
  ProgressAutosaveDto,
  SpecialtySelectionDto,
  SubmitApplicationDto,
} from '../types/professionalOnboarding';

const ACTIVE_STATUSES: ProfessionalApplicationStatus[] = ['DRAFT', 'PENDING_REVIEW', 'NEEDS_CHANGES'];
const EDITABLE_STATUSES: ProfessionalApplicationStatus[] = ['DRAFT', 'NEEDS_CHANGES'];
const E164 = /^\+[1-9][0-9]{7,14}$/;
const COUNTRY_CODE = /^[A-Z]{2}$/;
const MAX_IDEMPOTENCY_KEY_LENGTH = 64;
const SNAPSHOT_SCHEMA_VERSION = 1;

export type ProfessionalOnboardingErrorCode =
  | 'PROFESSIONAL_APPLICATION_NOT_FOUND'
  | 'PROFESSIONAL_APPLICATION_NOT_EDITABLE'
  | 'PROFESSIONAL_APPLICATION_ALREADY_PENDING'
  | 'PROFESSIONAL_APPLICATION_INVALID_STATE'
  | 'PROFESSIONAL_APPLICATION_VALIDATION_FAILED'
  | 'PROFESSIONAL_SPECIALTY_PROFESSION_MISMATCH'
  | 'PROFESSIONAL_CREDENTIAL_OWNERSHIP_MISMATCH'
  | 'PROFESSIONAL_APPLICATION_CONFLICT'
  | 'PROFESSIONAL_REAPPLICATION_NOT_ENABLED'
  | 'PROFESSIONAL_ONBOARDING_INPUT_INVALID';

export class ProfessionalOnboardingError extends Error {
  constructor(
    public readonly code: ProfessionalOnboardingErrorCode,
    public readonly status: number,
    message: string,
    public readonly details?: { fields?: string[] },
  ) {
    super(message);
  }
}

const applicationInclude = {
  healthProfession: { select: { id: true, code: true, name: true, isActive: true, requiresSpecialty: true } },
  specialties: {
    orderBy: [{ isPrimary: 'desc' as const }, { createdAt: 'asc' as const }],
    include: { specialty: { select: { id: true, code: true, name: true, healthProfessionId: true, isActive: true } } },
  },
  credentials: {
    orderBy: [{ isPrimary: 'desc' as const }, { sortOrder: 'asc' as const }],
    include: {
      credential: {
        select: {
          id: true, credentialType: true, countryCode: true, exactTitle: true,
          institutionId: true, institutionNameSnapshot: true, registrationAuthorityId: true,
          authorityNameSnapshot: true, registrationNumberOriginal: true, issuedAt: true,
          expiresAt: true, verificationStatus: true, ownershipStatus: true, deletedAt: true,
          documents: {
            where: { deletedAt: null }, orderBy: { createdAt: 'asc' as const },
            select: { id: true, kind: true, mimeType: true, sizeBytes: true, checksumSha256: true, pageCount: true, scanStatus: true, scannedAt: true, createdAt: true },
          },
        },
      },
    },
  },
  location: true,
  languages: {
    orderBy: { createdAt: 'asc' as const },
    include: { language: { select: { id: true, code: true, name: true, isActive: true } } },
  },
  assets: {
    where: { deletedAt: null }, orderBy: [{ category: 'asc' as const }, { sortOrder: 'asc' as const }],
    select: { id: true, category: true, mimeType: true, sizeBytes: true, width: true, height: true, checksumSha256: true, sortOrder: true, moderationStatus: true, createdAt: true },
  },
} satisfies Prisma.ProfessionalApplicationInclude;

type ApplicationAggregate = Prisma.ProfessionalApplicationGetPayload<{ include: typeof applicationInclude }>;

function invalid(message: string, fields?: string[]): never {
  throw new ProfessionalOnboardingError('PROFESSIONAL_ONBOARDING_INPUT_INVALID', 422, message, fields ? { fields } : undefined);
}

function cleanOptionalString(value: unknown, field: string, max: number): string | null | undefined {
  if (value === undefined) return undefined;
  if (value === null) return null;
  if (typeof value !== 'string') invalid(`${field} debe ser texto.`, [field]);
  const cleaned = value.trim();
  if (!cleaned) return null;
  if (cleaned.length > max) invalid(`${field} excede la longitud permitida.`, [field]);
  return cleaned;
}

function requiredString(value: unknown, field: string, max: number): string {
  const cleaned = cleanOptionalString(value, field, max);
  if (!cleaned) invalid(`${field} es obligatorio.`, [field]);
  return cleaned;
}

function expectedRevision(value: unknown): number {
  if (!Number.isInteger(value) || Number(value) < 1) invalid('expectedRevision debe ser un entero positivo.', ['expectedRevision']);
  return Number(value);
}

function visitedStep(value: unknown): number | undefined {
  if (value === undefined) return undefined;
  if (!Number.isInteger(value) || Number(value) < 1 || Number(value) > 5) invalid('lastVisitedStep debe estar entre 1 y 5.', ['lastVisitedStep']);
  return Number(value);
}

function normalizeCountry(value: unknown, field: string): string | null | undefined {
  const cleaned = cleanOptionalString(value, field, 2)?.toUpperCase();
  if (cleaned && !COUNTRY_CODE.test(cleaned)) invalid(`${field} debe ser un código ISO de dos letras.`, [field]);
  return cleaned;
}

function normalizePhone(value: unknown, field: string): string | null | undefined {
  const cleaned = cleanOptionalString(value, field, 20);
  if (cleaned && !E164.test(cleaned)) invalid(`${field} debe usar formato E.164.`, [field]);
  return cleaned;
}

function normalizeDate(value: unknown, field: string): Date | null | undefined {
  if (value === undefined) return undefined;
  if (value === null || value === '') return null;
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) invalid(`${field} debe usar YYYY-MM-DD.`, [field]);
  const date = new Date(`${value}T00:00:00.000Z`);
  if (Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== value) invalid(`${field} no es una fecha válida.`, [field]);
  return date;
}

function normalizeRegistrationNumber(value: string): string {
  return value.normalize('NFKC').toUpperCase().replace(/[^A-Z0-9]/g, '');
}

async function lockUser(tx: Prisma.TransactionClient, userId: string): Promise<void> {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`professional-onboarding:${userId}`}))`;
}

async function lockOwnedApplication(tx: Prisma.TransactionClient, userId: string) {
  const rows = await tx.$queryRaw<Array<{ id: string }>>`
    SELECT "id" FROM "ProfessionalApplication"
    WHERE "userId" = ${userId} AND "status" IN ('DRAFT', 'PENDING_REVIEW', 'NEEDS_CHANGES')
    ORDER BY "cycleNumber" DESC LIMIT 1 FOR UPDATE
  `;
  if (!rows[0]) throw new ProfessionalOnboardingError('PROFESSIONAL_APPLICATION_NOT_FOUND', 404, 'No existe una solicitud profesional activa.');
  return tx.professionalApplication.findUniqueOrThrow({ where: { id: rows[0].id } });
}

function assertEditable(application: { status: ProfessionalApplicationStatus; currentRevision: number }, revision: unknown): number {
  const expected = expectedRevision(revision);
  if (!EDITABLE_STATUSES.includes(application.status)) {
    const code = application.status === 'PENDING_REVIEW'
      ? 'PROFESSIONAL_APPLICATION_ALREADY_PENDING'
      : 'PROFESSIONAL_APPLICATION_NOT_EDITABLE';
    throw new ProfessionalOnboardingError(code, 409, 'La solicitud no está disponible para edición.');
  }
  if (application.currentRevision !== expected) {
    throw new ProfessionalOnboardingError('PROFESSIONAL_APPLICATION_CONFLICT', 409, 'La solicitud cambió en otra sesión. Recarga antes de guardar.');
  }
  return expected;
}

function publicAggregate(application: ApplicationAggregate) {
  return {
    id: application.id,
    status: application.status,
    cycleNumber: application.cycleNumber,
    currentRevision: application.currentRevision,
    lastVisitedStep: application.lastVisitedStep,
    legalGivenNames: application.legalGivenNames,
    legalFamilyNames: application.legalFamilyNames,
    primaryPhoneE164: application.primaryPhoneE164,
    alternatePhoneE164: application.alternatePhoneE164,
    practiceCountryCode: application.practiceCountryCode,
    publicBio: application.publicBio,
    submittedAt: application.submittedAt,
    decidedAt: application.decidedAt,
    updatedAt: application.updatedAt,
    profession: application.healthProfession,
    specialties: application.specialties.map(({ specialty, isPrimary }) => ({ ...specialty, isPrimary })),
    credentials: application.credentials
      .filter(({ credential }) => !credential.deletedAt)
      .map(({ credential, isPrimary, sortOrder }) => ({
        id: credential.id,
        credentialType: credential.credentialType,
        countryCode: credential.countryCode,
        exactTitle: credential.exactTitle,
        institutionId: credential.institutionId,
        institutionNameSnapshot: credential.institutionNameSnapshot,
        registrationAuthorityId: credential.registrationAuthorityId,
        authorityNameSnapshot: credential.authorityNameSnapshot,
        registrationNumber: credential.registrationNumberOriginal,
        issuedAt: credential.issuedAt?.toISOString().slice(0, 10) ?? null,
        expiresAt: credential.expiresAt?.toISOString().slice(0, 10) ?? null,
        verificationStatus: credential.verificationStatus,
        ownershipStatus: credential.ownershipStatus,
        documents: credential.documents,
        isPrimary,
        sortOrder,
      })),
    location: application.location ? {
      name: application.location.name,
      countryCode: application.location.countryCode,
      administrativeArea1: application.location.administrativeArea1,
      administrativeArea2: application.location.administrativeArea2,
      city: application.location.city,
      street1: application.location.street1,
      street2: application.location.street2,
      reference: application.location.reference,
      postalCode: application.location.postalCode,
      floorNumber: application.location.floorNumber,
      officeLabel: application.location.officeLabel,
      instructions: application.location.instructions,
      latitude: application.location.latitude?.toNumber() ?? null,
      longitude: application.location.longitude?.toNumber() ?? null,
      locationPrecision: application.location.locationPrecision,
      providerType: application.location.providerType,
      providerPlaceId: application.location.providerPlaceId,
    } : null,
    languages: application.languages.map(({ language, proficiency }) => ({ ...language, proficiency })),
    assets: application.assets,
  };
}

function completion(application: ApplicationAggregate) {
  const identity = Boolean(application.legalGivenNames && application.legalFamilyNames && application.primaryPhoneE164
    && application.practiceCountryCode && application.healthProfession?.isActive);
  const location = Boolean(application.location?.countryCode && application.location.city && application.location.street1);
  const profile = Boolean(application.publicBio || application.languages.length);
  const sections = { identity, credentials: application.credentials.some(({ credential }) => !credential.deletedAt), location, profile };
  return { sections, percent: Math.round(Object.values(sections).filter(Boolean).length / 4 * 100) };
}

async function loadAggregate(client: Prisma.TransactionClient | typeof prisma, id: string): Promise<ApplicationAggregate> {
  return client.professionalApplication.findUniqueOrThrow({ where: { id }, include: applicationInclude });
}

export async function getProfessionalOnboardingBootstrap(userId: string) {
  const application = await prisma.professionalApplication.findFirst({
    where: { userId },
    orderBy: [{ createdAt: 'desc' }, { cycleNumber: 'desc' }],
    include: applicationInclude,
  });
  const access = await prisma.professionalAccess.findUnique({ where: { userId }, select: { status: true } });
  if (!application) {
    return { state: 'NOT_STARTED' as const, applicationId: null, currentRevision: null, lastVisitedStep: 1, profession: null, completion: null, access: { professionalAccessStatus: access?.status ?? null }, application: null };
  }
  return {
    state: application.status,
    applicationId: application.id,
    currentRevision: application.currentRevision,
    lastVisitedStep: application.lastVisitedStep,
    profession: application.healthProfession,
    completion: completion(application),
    access: { professionalAccessStatus: access?.status ?? null },
    application: publicAggregate(application),
  };
}

export async function startProfessionalOnboarding(userId: string) {
  return prisma.$transaction(async (tx) => {
    await lockUser(tx, userId);
    const active = await tx.professionalApplication.findFirst({
      where: { userId, status: { in: ACTIVE_STATUSES } }, orderBy: { cycleNumber: 'desc' }, include: applicationInclude,
    });
    if (active) return { created: false, application: publicAggregate(active) };
    const latest = await tx.professionalApplication.findFirst({ where: { userId }, orderBy: { cycleNumber: 'desc' } });
    if (latest) {
      throw new ProfessionalOnboardingError('PROFESSIONAL_REAPPLICATION_NOT_ENABLED', 409, 'La reaplicación después de una decisión final todavía no está habilitada.');
    }
    const application = await tx.professionalApplication.create({ data: { userId, cycleNumber: 1 }, include: applicationInclude });
    return { created: true, application: publicAggregate(application) };
  });
}

async function finishMutation(tx: Prisma.TransactionClient, applicationId: string, data: Prisma.ProfessionalApplicationUpdateInput) {
  await tx.professionalApplication.update({ where: { id: applicationId }, data: { ...data, currentRevision: { increment: 1 } } });
  return publicAggregate(await loadAggregate(tx, applicationId));
}

export async function autosaveIdentity(userId: string, input: IdentityAutosaveDto) {
  return prisma.$transaction(async (tx) => {
    const application = await lockOwnedApplication(tx, userId);
    assertEditable(application, input.expectedRevision);
    const professionId = cleanOptionalString(input.healthProfessionId, 'healthProfessionId', 80);
    if (professionId) {
      const profession = await tx.healthProfession.findFirst({ where: { id: professionId, isActive: true }, select: { id: true } });
      if (!profession) invalid('La profesión seleccionada no está activa.', ['healthProfessionId']);
      if (application.healthProfessionId && application.healthProfessionId !== professionId) {
        const incompatible = await tx.professionalApplicationSpecialty.count({
          where: { applicationId: application.id, specialty: { healthProfessionId: { not: professionId } } },
        });
        if (incompatible) throw new ProfessionalOnboardingError('PROFESSIONAL_APPLICATION_CONFLICT', 409, 'Elimina las especialidades incompatibles antes de cambiar de profesión.');
      }
    }
    return finishMutation(tx, application.id, {
      legalGivenNames: cleanOptionalString(input.legalGivenNames, 'legalGivenNames', 160),
      legalFamilyNames: cleanOptionalString(input.legalFamilyNames, 'legalFamilyNames', 160),
      primaryPhoneE164: normalizePhone(input.primaryPhoneE164, 'primaryPhoneE164'),
      alternatePhoneE164: normalizePhone(input.alternatePhoneE164, 'alternatePhoneE164'),
      practiceCountryCode: normalizeCountry(input.practiceCountryCode, 'practiceCountryCode'),
      healthProfession: professionId === undefined ? undefined : professionId === null ? { disconnect: true } : { connect: { id: professionId } },
      lastVisitedStep: visitedStep(input.lastVisitedStep),
    });
  });
}

export async function replaceSpecialties(userId: string, input: SpecialtySelectionDto) {
  return prisma.$transaction(async (tx) => {
    const application = await lockOwnedApplication(tx, userId);
    assertEditable(application, input.expectedRevision);
    if (!Array.isArray(input.specialties)) invalid('specialties debe ser una lista.', ['specialties']);
    const ids = input.specialties.map((item) => requiredString(item?.specialtyId, 'specialtyId', 80));
    if (new Set(ids).size !== ids.length) invalid('No se puede repetir una especialidad.', ['specialties']);
    if (input.specialties.filter(({ isPrimary }) => isPrimary).length > 1) invalid('Sólo una especialidad puede ser primaria.', ['specialties']);
    if (ids.length && !application.healthProfessionId) invalid('Selecciona una profesión antes de las especialidades.', ['healthProfessionId']);
    const specialties = ids.length ? await tx.specialty.findMany({ where: { id: { in: ids }, isActive: true }, select: { id: true, healthProfessionId: true } }) : [];
    if (specialties.length !== ids.length || specialties.some(({ healthProfessionId }) => healthProfessionId !== application.healthProfessionId)) {
      throw new ProfessionalOnboardingError('PROFESSIONAL_SPECIALTY_PROFESSION_MISMATCH', 422, 'Las especialidades deben estar activas y pertenecer a la profesión seleccionada.');
    }
    await tx.professionalApplicationSpecialty.deleteMany({ where: { applicationId: application.id } });
    if (ids.length) await tx.professionalApplicationSpecialty.createMany({ data: input.specialties.map(({ specialtyId, isPrimary }) => ({ applicationId: application.id, specialtyId, isPrimary: Boolean(isPrimary) })) });
    return finishMutation(tx, application.id, { lastVisitedStep: visitedStep(input.lastVisitedStep) });
  });
}

function credentialData(input: CredentialWriteDto) {
  if (!Object.values(ProfessionalCredentialType).includes(input.credentialType)) invalid('credentialType no es válido.', ['credentialType']);
  const countryCode = normalizeCountry(input.countryCode, 'countryCode');
  if (!countryCode) invalid('countryCode es obligatorio.', ['countryCode']);
  const institutionNameSnapshot = requiredString(input.institutionNameSnapshot, 'institutionNameSnapshot', 180);
  const registrationAuthorityId = cleanOptionalString(input.registrationAuthorityId, 'registrationAuthorityId', 80);
  const registrationNumberOriginal = cleanOptionalString(input.registrationNumber, 'registrationNumber', 120);
  if (Boolean(registrationAuthorityId) !== Boolean(registrationNumberOriginal)) invalid('La autoridad y el número registral deben enviarse juntos.', ['registrationAuthorityId', 'registrationNumber']);
  const issuedAt = normalizeDate(input.issuedAt, 'issuedAt');
  const expiresAt = normalizeDate(input.expiresAt, 'expiresAt');
  if (issuedAt && expiresAt && expiresAt < issuedAt) invalid('expiresAt no puede ser anterior a issuedAt.', ['expiresAt']);
  if (input.sortOrder !== undefined && (!Number.isInteger(input.sortOrder) || input.sortOrder < 0)) invalid('sortOrder debe ser un entero no negativo.', ['sortOrder']);
  return {
    credentialType: input.credentialType,
    countryCode,
    exactTitle: requiredString(input.exactTitle, 'exactTitle', 200),
    institutionId: cleanOptionalString(input.institutionId, 'institutionId', 80),
    institutionNameSnapshot,
    registrationAuthorityId,
    authorityNameSnapshot: cleanOptionalString(input.authorityNameSnapshot, 'authorityNameSnapshot', 180),
    registrationNumberOriginal,
    registrationNumberNormalized: registrationNumberOriginal ? normalizeRegistrationNumber(registrationNumberOriginal) : null,
    issuedAt,
    expiresAt,
  };
}

async function validateCredentialReferences(tx: Prisma.TransactionClient, data: ReturnType<typeof credentialData>) {
  if (data.institutionId) {
    const institution = await tx.institution.findFirst({ where: { id: data.institutionId, isActive: true }, select: { id: true } });
    if (!institution) invalid('La institución seleccionada no está activa.', ['institutionId']);
  }
  if (data.registrationAuthorityId) {
    const authority = await tx.registrationAuthority.findFirst({ where: { id: data.registrationAuthorityId, isActive: true, isVerified: true }, select: { id: true } });
    if (!authority) invalid('La autoridad registral no está disponible.', ['registrationAuthorityId']);
  }
}

export async function createCredential(userId: string, input: CredentialWriteDto) {
  return prisma.$transaction(async (tx) => {
    const application = await lockOwnedApplication(tx, userId);
    assertEditable(application, input.expectedRevision);
    const data = credentialData(input);
    await validateCredentialReferences(tx, data);
    const credential = await tx.professionalCredential.create({ data: { userId, ...data } });
    if (input.isPrimary) await tx.professionalApplicationCredential.updateMany({ where: { applicationId: application.id, isPrimary: true }, data: { isPrimary: false } });
    await tx.professionalApplicationCredential.create({ data: { applicationId: application.id, credentialId: credential.id, isPrimary: Boolean(input.isPrimary), sortOrder: input.sortOrder ?? 0 } });
    return finishMutation(tx, application.id, { lastVisitedStep: visitedStep(input.lastVisitedStep) });
  });
}

export async function updateCredential(userId: string, credentialId: string, input: CredentialWriteDto) {
  return prisma.$transaction(async (tx) => {
    const application = await lockOwnedApplication(tx, userId);
    assertEditable(application, input.expectedRevision);
    const link = await tx.professionalApplicationCredential.findUnique({
      where: { applicationId_credentialId: { applicationId: application.id, credentialId } }, include: { credential: { select: { userId: true, deletedAt: true } } },
    });
    if (!link || link.credential.userId !== userId || link.credential.deletedAt) {
      throw new ProfessionalOnboardingError('PROFESSIONAL_CREDENTIAL_OWNERSHIP_MISMATCH', 404, 'La credencial no pertenece a esta solicitud.');
    }
    const data = credentialData(input);
    await validateCredentialReferences(tx, data);
    await tx.professionalCredential.update({ where: { id: credentialId }, data });
    if (input.isPrimary) await tx.professionalApplicationCredential.updateMany({ where: { applicationId: application.id, isPrimary: true, credentialId: { not: credentialId } }, data: { isPrimary: false } });
    await tx.professionalApplicationCredential.update({ where: { applicationId_credentialId: { applicationId: application.id, credentialId } }, data: { isPrimary: Boolean(input.isPrimary), sortOrder: input.sortOrder ?? link.sortOrder } });
    return finishMutation(tx, application.id, { lastVisitedStep: visitedStep(input.lastVisitedStep) });
  });
}

export async function deleteCredential(userId: string, credentialId: string, input: { expectedRevision: number }) {
  return prisma.$transaction(async (tx) => {
    const application = await lockOwnedApplication(tx, userId);
    assertEditable(application, input.expectedRevision);
    const link = await tx.professionalApplicationCredential.findUnique({
      where: { applicationId_credentialId: { applicationId: application.id, credentialId } }, include: { credential: { select: { userId: true, deletedAt: true } } },
    });
    if (!link || link.credential.userId !== userId || link.credential.deletedAt) {
      throw new ProfessionalOnboardingError('PROFESSIONAL_CREDENTIAL_OWNERSHIP_MISMATCH', 404, 'La credencial no pertenece a esta solicitud.');
    }
    const activeDocuments = await tx.credentialDocument.count({ where: { credentialId, deletedAt: null } });
    if (activeDocuments) throw new ProfessionalOnboardingError('PROFESSIONAL_APPLICATION_CONFLICT', 409, 'Elimina primero los documentos asociados a la credencial.');
    await tx.professionalApplicationCredential.delete({ where: { id: link.id } });
    await tx.professionalCredential.update({ where: { id: credentialId }, data: { deletedAt: new Date() } });
    return finishMutation(tx, application.id, {});
  });
}

export async function autosaveLocation(userId: string, input: LocationAutosaveDto) {
  return prisma.$transaction(async (tx) => {
    const application = await lockOwnedApplication(tx, userId);
    assertEditable(application, input.expectedRevision);
    const latitude = input.latitude === undefined ? undefined : input.latitude === null ? null : Number(input.latitude);
    const longitude = input.longitude === undefined ? undefined : input.longitude === null ? null : Number(input.longitude);
    if ((latitude !== undefined && longitude === undefined) || (longitude !== undefined && latitude === undefined) || ((latitude === null) !== (longitude === null))) {
      invalid('latitude y longitude deben actualizarse juntas.', ['latitude', 'longitude']);
    }
    if (latitude !== undefined && latitude !== null && (!Number.isFinite(latitude) || latitude < -90 || latitude > 90)) invalid('latitude está fuera de rango.', ['latitude']);
    if (longitude !== undefined && longitude !== null && (!Number.isFinite(longitude) || longitude < -180 || longitude > 180)) invalid('longitude está fuera de rango.', ['longitude']);
    if (input.floorNumber !== undefined && input.floorNumber !== null && (!Number.isInteger(input.floorNumber) || input.floorNumber < 0)) invalid('floorNumber debe ser 0 o un entero positivo.', ['floorNumber']);
    if (input.locationPrecision !== undefined && !Object.values(LocationPrecision).includes(input.locationPrecision)) invalid('locationPrecision no es válido.', ['locationPrecision']);
    const providerType = cleanOptionalString(input.providerType, 'providerType', 40);
    const providerPlaceId = cleanOptionalString(input.providerPlaceId, 'providerPlaceId', 500);
    if (providerPlaceId && !providerType) invalid('providerType es obligatorio cuando existe providerPlaceId.', ['providerType']);
    const data = {
      name: cleanOptionalString(input.name, 'name', 160),
      countryCode: normalizeCountry(input.countryCode, 'countryCode'),
      administrativeArea1: cleanOptionalString(input.administrativeArea1, 'administrativeArea1', 120),
      administrativeArea2: cleanOptionalString(input.administrativeArea2, 'administrativeArea2', 120),
      city: cleanOptionalString(input.city, 'city', 120),
      street1: cleanOptionalString(input.street1, 'street1', 200),
      street2: cleanOptionalString(input.street2, 'street2', 200),
      reference: cleanOptionalString(input.reference, 'reference', 300),
      postalCode: cleanOptionalString(input.postalCode, 'postalCode', 20),
      floorNumber: input.floorNumber,
      officeLabel: cleanOptionalString(input.officeLabel, 'officeLabel', 40),
      instructions: cleanOptionalString(input.instructions, 'instructions', 500),
      latitude,
      longitude,
      locationPrecision: input.locationPrecision,
      providerType,
      providerPlaceId,
    };
    await tx.professionalApplicationLocation.upsert({ where: { applicationId: application.id }, create: { applicationId: application.id, ...data }, update: data });
    return finishMutation(tx, application.id, { lastVisitedStep: visitedStep(input.lastVisitedStep) });
  });
}

export async function autosaveProfile(userId: string, input: ProfileAutosaveDto) {
  return prisma.$transaction(async (tx) => {
    const application = await lockOwnedApplication(tx, userId);
    assertEditable(application, input.expectedRevision);
    if (input.languages !== undefined) {
      if (!Array.isArray(input.languages)) invalid('languages debe ser una lista.', ['languages']);
      const ids = input.languages.map(({ languageId }) => requiredString(languageId, 'languageId', 80));
      if (new Set(ids).size !== ids.length) invalid('No se puede repetir un idioma.', ['languages']);
      const active = ids.length ? await tx.language.count({ where: { id: { in: ids }, isActive: true } }) : 0;
      if (active !== ids.length) invalid('Todos los idiomas deben estar activos.', ['languages']);
      await tx.professionalApplicationLanguage.deleteMany({ where: { applicationId: application.id } });
      if (ids.length) await tx.professionalApplicationLanguage.createMany({ data: input.languages.map(({ languageId, proficiency }) => ({ applicationId: application.id, languageId, proficiency: cleanOptionalString(proficiency, 'proficiency', 40) })) });
    }
    return finishMutation(tx, application.id, {
      publicBio: cleanOptionalString(input.publicBio, 'publicBio', 1000),
      lastVisitedStep: visitedStep(input.lastVisitedStep),
    });
  });
}

export async function updateProgress(userId: string, input: ProgressAutosaveDto) {
  return prisma.$transaction(async (tx) => {
    const application = await lockOwnedApplication(tx, userId);
    assertEditable(application, input.expectedRevision);
    return finishMutation(tx, application.id, { lastVisitedStep: visitedStep(input.lastVisitedStep) });
  });
}

export function validateAggregateForSubmit(application: ApplicationAggregate): string[] {
  const missing: string[] = [];
  if (!application.legalGivenNames?.trim()) missing.push('legalGivenNames');
  if (!application.legalFamilyNames?.trim()) missing.push('legalFamilyNames');
  if (!application.primaryPhoneE164 || !E164.test(application.primaryPhoneE164)) missing.push('primaryPhoneE164');
  if (!application.practiceCountryCode || !COUNTRY_CODE.test(application.practiceCountryCode)) missing.push('practiceCountryCode');
  if (!application.healthProfession?.isActive) missing.push('healthProfessionId');
  if (!application.location?.countryCode) missing.push('location.countryCode');
  if (!application.location?.city?.trim()) missing.push('location.city');
  if (!application.location?.street1?.trim()) missing.push('location.street1');
  // Specialty, credential and language requirements are intentionally deferred
  // until an explicit versioned profession policy defines them.
  return missing;
}

function snapshotPayload(application: ApplicationAggregate, revision: number) {
  const aggregate = publicAggregate(application);
  return {
    schemaVersion: SNAPSHOT_SCHEMA_VERSION,
    revision,
    application: {
      ...aggregate,
      status: 'PENDING_REVIEW',
      currentRevision: revision,
      // Operational timestamps are not part of the applicant-submitted facts.
      submittedAt: undefined,
      decidedAt: undefined,
      updatedAt: undefined,
    },
  };
}

export function stableJson(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record).filter((key) => record[key] !== undefined).sort().map((key) => `${JSON.stringify(key)}:${stableJson(record[key])}`).join(',')}}`;
}

export function hashSnapshotPayload(payload: unknown): string {
  return createHash('sha256').update(stableJson(payload)).digest('hex');
}

function normalizeIdempotencyKey(value: string | undefined): string {
  if (!value || !/^[A-Za-z0-9._:-]+$/.test(value) || value.length > MAX_IDEMPOTENCY_KEY_LENGTH) {
    invalid('Idempotency-Key es obligatorio y debe contener como máximo 64 caracteres seguros.', ['Idempotency-Key']);
  }
  return value;
}

export async function submitProfessionalApplication(userId: string, input: SubmitApplicationDto, rawIdempotencyKey: string | undefined) {
  const key = normalizeIdempotencyKey(rawIdempotencyKey);
  return prisma.$transaction(async (tx) => {
    await lockUser(tx, userId);
    const application = await lockOwnedApplication(tx, userId);
    const ownedByKey = await tx.professionalApplicationReviewLog.findUnique({
      where: { idempotencyKey: `${application.id}:${key}` }, include: { snapshot: true, application: true },
    });
    if (ownedByKey?.snapshot) return {
      idempotent: true,
      application: ownedByKey.application,
      snapshot: {
        id: ownedByKey.snapshot.id,
        revision: ownedByKey.snapshot.revision,
        payloadHash: ownedByKey.snapshot.payloadHash,
        createdAt: ownedByKey.snapshot.createdAt,
      },
    };

    if (application.status === 'PENDING_REVIEW') throw new ProfessionalOnboardingError('PROFESSIONAL_APPLICATION_ALREADY_PENDING', 409, 'La solicitud ya está pendiente de revisión.');
    if (!EDITABLE_STATUSES.includes(application.status)) throw new ProfessionalOnboardingError('PROFESSIONAL_APPLICATION_INVALID_STATE', 409, 'La solicitud no puede enviarse desde su estado actual.');
    assertEditable(application, input.expectedRevision);
    const aggregate = await loadAggregate(tx, application.id);
    const fields = validateAggregateForSubmit(aggregate);
    if (fields.length) throw new ProfessionalOnboardingError('PROFESSIONAL_APPLICATION_VALIDATION_FAILED', 422, 'La solicitud todavía está incompleta.', { fields });
    const revision = application.currentRevision + 1;
    const payload = snapshotPayload(aggregate, revision);
    const snapshot = await tx.professionalApplicationSnapshot.create({ data: {
      applicationId: application.id,
      revision,
      schemaVersion: SNAPSHOT_SCHEMA_VERSION,
      payload: payload as Prisma.InputJsonValue,
      payloadHash: hashSnapshotPayload(payload),
    } });
    const submittedAt = new Date();
    const updated = await tx.professionalApplication.update({ where: { id: application.id }, data: {
      status: 'PENDING_REVIEW', submittedAt, currentRevision: revision,
    } });
    await tx.professionalApplicationReviewLog.create({ data: {
      applicationId: application.id,
      snapshotId: snapshot.id,
      actorUserId: userId,
      action: application.status === 'NEEDS_CHANGES' ? 'RESUBMITTED' : 'SUBMITTED',
      previousStatus: application.status,
      newStatus: 'PENDING_REVIEW',
      idempotencyKey: `${application.id}:${key}`,
    } });
    return {
      idempotent: false,
      application: updated,
      snapshot: { id: snapshot.id, revision: snapshot.revision, payloadHash: snapshot.payloadHash, createdAt: snapshot.createdAt },
    };
  });
}

export async function listProfessions() {
  return prisma.healthProfession.findMany({ where: { isActive: true }, orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }], select: { id: true, code: true, name: true, requiresSpecialty: true } });
}

export async function listSpecialties(healthProfessionId: string) {
  if (!healthProfessionId) invalid('healthProfessionId es obligatorio.', ['healthProfessionId']);
  return prisma.specialty.findMany({ where: { healthProfessionId, isActive: true, healthProfession: { isActive: true } }, orderBy: { name: 'asc' }, select: { id: true, code: true, name: true, healthProfessionId: true } });
}

export async function listLanguages() {
  return prisma.language.findMany({ where: { isActive: true }, orderBy: { nameNormalized: 'asc' }, select: { id: true, code: true, name: true } });
}
