import { createHash } from 'crypto';
import { readFileSync } from 'fs';
import path from 'path';
import { normalizeCatalogName } from './catalogNameNormalization';
import type {
  CatalogChecksums,
  CatalogEnvelope,
  InstitutionCatalogRecord,
  LanguageCatalogRecord,
  LoadedProfessionalCatalogs,
  ProfessionCatalogRecord,
  RegistrationAuthorityCatalogRecord,
  SpecialtyMappingCatalogRecord,
} from './professionalCatalog.types';

const FILES = {
  professions: 'professions.v1.json',
  languages: 'languages.v1.json',
  registrationAuthorities: 'registration-authorities.ec.v1.json',
  institutions: 'institutions.v1.json',
  specialties: 'specialties.v1.json',
} as const;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function loadJson(filePath: string): unknown {
  return JSON.parse(readFileSync(filePath, 'utf8')) as unknown;
}

function assertEnvelope<T>(value: unknown, filename: string): asserts value is CatalogEnvelope<T> {
  if (!isRecord(value) || value.schemaVersion !== 1 || typeof value.catalogVersion !== 'string'
    || typeof value.source !== 'string' || typeof value.publishedAt !== 'string' || !Array.isArray(value.records)) {
    throw new Error(`${filename}: formato de catálogo inválido.`);
  }
}

function requiredString(record: Record<string, unknown>, field: string, filename: string): string {
  const value = record[field];
  if (typeof value !== 'string' || !value.trim()) throw new Error(`${filename}: ${field} es obligatorio.`);
  return value;
}

function validateNormalized(record: Record<string, unknown>, filename: string): void {
  const displayName = requiredString(record, 'displayName', filename);
  const normalizedName = requiredString(record, 'normalizedName', filename);
  const expected = normalizeCatalogName(displayName);
  if (normalizedName !== expected) {
    throw new Error(`${filename}: normalizedName de "${displayName}" debe ser "${expected}".`);
  }
}

function validateRecords(envelope: CatalogEnvelope<unknown>, filename: string, kind: keyof typeof FILES): void {
  const identities = new Set<string>();
  const normalizedNames = new Set<string>();
  for (const raw of envelope.records) {
    if (!isRecord(raw)) throw new Error(`${filename}: cada registro debe ser un objeto.`);
    validateNormalized(raw, filename);
    const normalizedName = requiredString(raw, 'normalizedName', filename);
    if (normalizedNames.has(normalizedName)) throw new Error(`${filename}: normalizedName duplicado: ${normalizedName}.`);
    normalizedNames.add(normalizedName);

    let identity: string;
    if (kind === 'professions' || kind === 'languages') identity = requiredString(raw, 'code', filename);
    else if (kind === 'registrationAuthorities') {
      identity = `${requiredString(raw, 'countryCode', filename)}:${requiredString(raw, 'registryNamespace', filename)}`;
      if (!['APPROVED_FOR_IMPORT', 'PENDING_CATALOG_DECISION'].includes(String(raw.decisionStatus))) {
        throw new Error(`${filename}: decisionStatus inválido.`);
      }
    } else if (kind === 'institutions') {
      identity = `${requiredString(raw, 'countryCode', filename)}:${normalizedName}`;
    } else {
      identity = `${requiredString(raw, 'professionCode', filename)}:${requiredString(raw, 'specialtyCode', filename)}`;
      if (!Array.isArray(raw.legacyNormalizedNames)) throw new Error(`${filename}: legacyNormalizedNames debe ser un array.`);
      for (const legacyName of raw.legacyNormalizedNames) {
        if (typeof legacyName !== 'string' || normalizeCatalogName(legacyName) !== legacyName) {
          throw new Error(`${filename}: legacyNormalizedNames debe contener nombres ya normalizados.`);
        }
      }
    }
    if (identities.has(identity)) throw new Error(`${filename}: identidad duplicada: ${identity}.`);
    identities.add(identity);
  }
}

export function loadProfessionalCatalogs(catalogDirectory = path.resolve(process.cwd(), 'catalogs')): LoadedProfessionalCatalogs {
  const manifestPath = path.join(catalogDirectory, 'checksums.v1.json');
  const manifest = loadJson(manifestPath);
  if (!isRecord(manifest) || manifest.algorithm !== 'sha256' || !isRecord(manifest.files)) {
    throw new Error('checksums.v1.json: manifiesto inválido.');
  }
  const checksums = manifest as unknown as CatalogChecksums;
  const loaded: Partial<Record<keyof typeof FILES, CatalogEnvelope<unknown>>> = {};
  const verifiedChecksums: Record<string, string> = {};

  for (const [kind, filename] of Object.entries(FILES) as [keyof typeof FILES, string][]) {
    const filePath = path.join(catalogDirectory, filename);
    const contents = readFileSync(filePath);
    const actualChecksum = createHash('sha256').update(contents).digest('hex');
    const expectedChecksum = checksums.files[filename];
    if (!expectedChecksum || actualChecksum !== expectedChecksum) {
      throw new Error(`${filename}: checksum SHA-256 no coincide con el manifiesto aprobado.`);
    }
    const envelope = JSON.parse(contents.toString('utf8')) as unknown;
    assertEnvelope<unknown>(envelope, filename);
    validateRecords(envelope, filename, kind);
    loaded[kind] = envelope;
    verifiedChecksums[filename] = actualChecksum;
  }

  return {
    professions: loaded.professions as CatalogEnvelope<ProfessionCatalogRecord>,
    languages: loaded.languages as CatalogEnvelope<LanguageCatalogRecord>,
    registrationAuthorities: loaded.registrationAuthorities as CatalogEnvelope<RegistrationAuthorityCatalogRecord>,
    institutions: loaded.institutions as CatalogEnvelope<InstitutionCatalogRecord>,
    specialties: loaded.specialties as CatalogEnvelope<SpecialtyMappingCatalogRecord>,
    checksums: verifiedChecksums,
  };
}
