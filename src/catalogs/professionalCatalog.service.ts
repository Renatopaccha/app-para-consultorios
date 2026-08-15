import type { Prisma, PrismaClient } from '../../generated/prisma';
import { normalizeCatalogName } from './catalogNameNormalization';
import { loadProfessionalCatalogs } from './professionalCatalog.loader';
import type {
  CatalogAction,
  LoadedProfessionalCatalogs,
  ProfessionalCatalogPlan,
  SpecialtyAuditEntry,
  SpecialtyMappingCatalogRecord,
} from './professionalCatalog.types';

type CatalogDbClient = PrismaClient | Prisma.TransactionClient;

interface PlanContext {
  environment: string;
  databaseName: string;
  mode?: 'DRY_RUN' | 'APPLY';
  catalogDirectory?: string;
}

interface SpecialtyRow {
  id: string;
  name: string;
  healthProfessionId?: string | null;
  code?: string | null;
  nameNormalized?: string | null;
  isActive?: boolean;
  healthProfession?: { code: string } | null;
  _count: { doctorProfiles: number; clinicProfiles: number };
}

export class ProfessionalCatalogConflictError extends Error {
  constructor(public readonly plan: ProfessionalCatalogPlan) {
    super(`Importación abortada: ${plan.conflicts.length} conflicto(s) de catálogo.`);
  }
}

function changesFor(current: Record<string, unknown>, desired: Record<string, unknown>): Record<string, { from: unknown; to: unknown }> {
  const changes: Record<string, { from: unknown; to: unknown }> = {};
  for (const [key, value] of Object.entries(desired)) {
    if (current[key] !== value) changes[key] = { from: current[key] ?? null, to: value };
  }
  return changes;
}

function action(entity: string, key: string, operation: CatalogAction['operation'], changes?: CatalogAction['changes']): CatalogAction {
  return changes && Object.keys(changes).length ? { entity, key, operation, changes } : { entity, key, operation };
}

function summarize(plan: Omit<ProfessionalCatalogPlan, 'summary'>): ProfessionalCatalogPlan {
  return {
    ...plan,
    summary: {
      creates: plan.actions.filter(({ operation }) => operation === 'CREATE').length,
      updates: plan.actions.filter(({ operation }) => operation === 'UPDATE').length,
      unchanged: plan.actions.filter(({ operation }) => operation === 'UNCHANGED').length,
      pendingDecisions: plan.actions.filter(({ operation }) => operation === 'SKIP_PENDING_DECISION').length,
      unmappedSpecialties: plan.specialtyAudit.filter(({ status }) => status === 'UNMAPPED_REQUIRES_REVIEW').length,
    },
  };
}

function mappingIndex(catalogs: LoadedProfessionalCatalogs): Map<string, SpecialtyMappingCatalogRecord[]> {
  const index = new Map<string, SpecialtyMappingCatalogRecord[]>();
  for (const mapping of catalogs.specialties.records) {
    const names = new Set([mapping.normalizedName, ...mapping.legacyNormalizedNames]);
    for (const name of names) index.set(name, [...(index.get(name) ?? []), mapping]);
  }
  return index;
}

async function inspectPrerequisites(db: CatalogDbClient): Promise<string[]> {
  const tables = await db.$queryRaw<Array<{ table_name: string }>>`
    SELECT table_name
    FROM information_schema.tables
    WHERE table_schema = 'public'
      AND table_name IN ('HealthProfession', 'RegistrationAuthority', 'Institution', 'Language')
  `;
  const columns = await db.$queryRaw<Array<{ column_name: string }>>`
    SELECT column_name
    FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'Specialty'
      AND column_name IN ('healthProfessionId', 'code', 'nameNormalized', 'isActive')
  `;
  const foundTables = new Set(tables.map(({ table_name }) => table_name));
  const foundColumns = new Set(columns.map(({ column_name }) => column_name));
  return [
    ...['HealthProfession', 'RegistrationAuthority', 'Institution', 'Language']
      .filter((name) => !foundTables.has(name)).map((name) => `table:${name}`),
    ...['healthProfessionId', 'code', 'nameNormalized', 'isActive']
      .filter((name) => !foundColumns.has(name)).map((name) => `Specialty.${name}`),
  ];
}

async function readLegacySpecialties(db: CatalogDbClient, ready: boolean): Promise<SpecialtyRow[]> {
  if (!ready) {
    return db.specialty.findMany({
      select: { id: true, name: true, _count: { select: { doctorProfiles: true, clinicProfiles: true } } },
      orderBy: { name: 'asc' },
    });
  }
  return db.specialty.findMany({
    select: {
      id: true,
      name: true,
      healthProfessionId: true,
      code: true,
      nameNormalized: true,
      isActive: true,
      healthProfession: { select: { code: true } },
      _count: { select: { doctorProfiles: true, clinicProfiles: true } },
    },
    orderBy: { name: 'asc' },
  });
}

function auditSpecialties(rows: SpecialtyRow[], mappings: Map<string, SpecialtyMappingCatalogRecord[]>, conflicts: string[]): SpecialtyAuditEntry[] {
  const duplicateNames = new Map<string, SpecialtyRow[]>();
  for (const row of rows) {
    const normalized = normalizeCatalogName(row.name);
    duplicateNames.set(normalized, [...(duplicateNames.get(normalized) ?? []), row]);
  }
  for (const [name, duplicates] of duplicateNames) {
    if (duplicates.length > 1) conflicts.push(`Specialty normalizable duplicada "${name}": ${duplicates.map(({ id }) => id).join(', ')}.`);
  }

  return rows.map((row) => {
    const normalizedName = normalizeCatalogName(row.name);
    const matches = mappings.get(normalizedName) ?? [];
    if (matches.length !== 1) {
      if (matches.length > 1) conflicts.push(`Specialty ${row.id} coincide con más de un mapeo versionado.`);
      return {
        id: row.id, name: row.name, normalizedName,
        doctorProfiles: row._count.doctorProfiles, clinicProfiles: row._count.clinicProfiles,
        classification: 'OTHER_OR_UNKNOWN', proposedCode: null, status: 'UNMAPPED_REQUIRES_REVIEW',
      };
    }
    const mapping = matches[0]!;
    const alreadyMapped = row.code === mapping.specialtyCode
      && row.nameNormalized === mapping.normalizedName
      && row.isActive === mapping.isActive
      && row.healthProfession?.code === mapping.professionCode;
    return {
      id: row.id, name: row.name, normalizedName,
      doctorProfiles: row._count.doctorProfiles, clinicProfiles: row._count.clinicProfiles,
      classification: mapping.professionCode, proposedCode: mapping.specialtyCode,
      status: alreadyMapped ? 'ALREADY_MAPPED' : 'MAPPED',
    };
  });
}

export async function planProfessionalCatalogImport(db: CatalogDbClient, context: PlanContext): Promise<ProfessionalCatalogPlan> {
  const catalogs = loadProfessionalCatalogs(context.catalogDirectory);
  const missing = await inspectPrerequisites(db);
  const ready = missing.length === 0;
  const rows = await readLegacySpecialties(db, ready);
  const conflicts: string[] = [];
  const warnings: string[] = [];
  const actions: CatalogAction[] = [];
  const mappings = mappingIndex(catalogs);
  const specialtyAudit = auditSpecialties(rows, mappings, conflicts);

  if (!ready) {
    warnings.push('La migración professional_catalog_foundation debe aplicarse antes de calcular o ejecutar el import completo.');
    return summarize({
      mode: context.mode ?? 'DRY_RUN', database: { environment: context.environment, databaseName: context.databaseName },
      prerequisites: { ready, missing }, checksums: catalogs.checksums, actions, specialtyAudit, conflicts, warnings,
    });
  }

  const [professions, languages, authorities, institutions] = await Promise.all([
    db.healthProfession.findMany(), db.language.findMany(), db.registrationAuthority.findMany(), db.institution.findMany(),
  ]);
  const professionByCode = new Map(professions.map((record) => [record.code, record]));
  const professionByNormalized = new Map(professions.map((record) => [record.nameNormalized, record]));
  for (const desired of catalogs.professions.records) {
    const byCode = professionByCode.get(desired.code);
    const byName = professionByNormalized.get(desired.normalizedName);
    if (byName && byCode?.id !== byName.id) {
      conflicts.push(`HealthProfession ${desired.code}: normalizedName "${desired.normalizedName}" pertenece a otro ID.`);
      continue;
    }
    if (!byCode) {
      actions.push(action('HealthProfession', desired.code, 'CREATE'));
      continue;
    }
    const changes = changesFor(byCode, {
      name: desired.displayName, nameNormalized: desired.normalizedName, isActive: desired.isActive,
      requiresSpecialty: desired.requiresSpecialty, credentialPolicyVersion: desired.credentialPolicyVersion, sortOrder: desired.sortOrder,
    });
    actions.push(action('HealthProfession', desired.code, Object.keys(changes).length ? 'UPDATE' : 'UNCHANGED', changes));
  }

  const languageByCode = new Map(languages.map((record) => [record.code, record]));
  const languageByNormalized = new Map(languages.map((record) => [record.nameNormalized, record]));
  for (const desired of catalogs.languages.records) {
    const byCode = languageByCode.get(desired.code);
    const byName = languageByNormalized.get(desired.normalizedName);
    if (byName && byCode?.id !== byName.id) {
      conflicts.push(`Language ${desired.code}: normalizedName "${desired.normalizedName}" pertenece a otro ID.`);
      continue;
    }
    if (!byCode) {
      actions.push(action('Language', desired.code, 'CREATE'));
      continue;
    }
    const changes = changesFor(byCode, { name: desired.displayName, nameNormalized: desired.normalizedName, isActive: desired.isActive });
    actions.push(action('Language', desired.code, Object.keys(changes).length ? 'UPDATE' : 'UNCHANGED', changes));
  }

  const authorityByKey = new Map(authorities.map((record) => [`${record.countryCode}:${record.registryNamespace}`, record]));
  for (const desired of catalogs.registrationAuthorities.records) {
    const key = `${desired.countryCode}:${desired.registryNamespace}`;
    if (desired.decisionStatus === 'PENDING_CATALOG_DECISION') {
      actions.push(action('RegistrationAuthority', key, 'SKIP_PENDING_DECISION'));
      warnings.push(`${key}: ${desired.pendingDecision ?? 'Requiere decisión humana.'}`);
      continue;
    }
    const current = authorityByKey.get(key);
    if (!current) actions.push(action('RegistrationAuthority', key, 'CREATE'));
    else {
      const changes = changesFor(current, {
        name: desired.displayName, nameNormalized: desired.normalizedName, isVerified: desired.isVerified,
        isActive: desired.isActive, sourceReference: desired.sourceReference,
      });
      actions.push(action('RegistrationAuthority', key, Object.keys(changes).length ? 'UPDATE' : 'UNCHANGED', changes));
    }
  }

  const institutionByKey = new Map(institutions.map((record) => [`${record.countryCode}:${record.nameNormalized}`, record]));
  for (const desired of catalogs.institutions.records) {
    const key = `${desired.countryCode}:${desired.normalizedName}`;
    const current = institutionByKey.get(key);
    if (!current) actions.push(action('Institution', key, 'CREATE'));
    else {
      const changes = changesFor(current, {
        name: desired.displayName, isVerified: desired.isVerified, isActive: desired.isActive, sourceReference: desired.sourceReference,
      });
      actions.push(action('Institution', key, Object.keys(changes).length ? 'UPDATE' : 'UNCHANGED', changes));
    }
  }

  const specialtyById = new Map(rows.map((row) => [row.id, row]));
  for (const audited of specialtyAudit) {
    if (!audited.proposedCode) continue;
    const row = specialtyById.get(audited.id)!;
    const mapping = (mappings.get(audited.normalizedName) ?? [])[0]!;
    const duplicateCode = rows.find((candidate) => candidate.id !== row.id && candidate.code === mapping.specialtyCode);
    if (duplicateCode) {
      conflicts.push(`Specialty ${mapping.specialtyCode}: ya está asignado al ID ${duplicateCode.id}.`);
      continue;
    }
    const changes = changesFor({
      healthProfessionCode: row.healthProfession?.code ?? null, code: row.code ?? null,
      nameNormalized: row.nameNormalized ?? null, isActive: row.isActive,
    }, {
      healthProfessionCode: mapping.professionCode, code: mapping.specialtyCode,
      nameNormalized: mapping.normalizedName, isActive: mapping.isActive,
    });
    actions.push(action('Specialty', row.id, Object.keys(changes).length ? 'UPDATE' : 'UNCHANGED', changes));
  }

  return summarize({
    mode: context.mode ?? 'DRY_RUN', database: { environment: context.environment, databaseName: context.databaseName },
    prerequisites: { ready, missing }, checksums: catalogs.checksums, actions, specialtyAudit, conflicts, warnings,
  });
}

export async function applyProfessionalCatalogImport(prisma: PrismaClient, context: Omit<PlanContext, 'mode'>): Promise<ProfessionalCatalogPlan> {
  const catalogs = loadProfessionalCatalogs(context.catalogDirectory);
  return prisma.$transaction(async (tx) => {
    const plan = await planProfessionalCatalogImport(tx, { ...context, mode: 'APPLY' });
    if (!plan.prerequisites.ready || plan.conflicts.length) throw new ProfessionalCatalogConflictError(plan);
    const mustWrite = (entity: string, key: string): boolean => plan.actions.some(({ entity: plannedEntity, key: plannedKey, operation }) =>
      plannedEntity === entity && plannedKey === key && (operation === 'CREATE' || operation === 'UPDATE'));

    for (const record of catalogs.professions.records) {
      if (!mustWrite('HealthProfession', record.code)) continue;
      await tx.healthProfession.upsert({
        where: { code: record.code },
        update: {
          name: record.displayName, nameNormalized: record.normalizedName, isActive: record.isActive,
          requiresSpecialty: record.requiresSpecialty, credentialPolicyVersion: record.credentialPolicyVersion, sortOrder: record.sortOrder,
        },
        create: {
          code: record.code, name: record.displayName, nameNormalized: record.normalizedName, isActive: record.isActive,
          requiresSpecialty: record.requiresSpecialty, credentialPolicyVersion: record.credentialPolicyVersion, sortOrder: record.sortOrder,
        },
      });
    }
    for (const record of catalogs.languages.records) {
      if (!mustWrite('Language', record.code)) continue;
      await tx.language.upsert({
        where: { code: record.code },
        update: { name: record.displayName, nameNormalized: record.normalizedName, isActive: record.isActive },
        create: { code: record.code, name: record.displayName, nameNormalized: record.normalizedName, isActive: record.isActive },
      });
    }
    for (const record of catalogs.registrationAuthorities.records.filter(({ decisionStatus }) => decisionStatus === 'APPROVED_FOR_IMPORT')) {
      const authorityKey = `${record.countryCode}:${record.registryNamespace}`;
      if (!mustWrite('RegistrationAuthority', authorityKey)) continue;
      const healthProfession = record.healthProfessionCode
        ? await tx.healthProfession.findUniqueOrThrow({ where: { code: record.healthProfessionCode }, select: { id: true } })
        : null;
      await tx.registrationAuthority.upsert({
        where: { countryCode_registryNamespace: { countryCode: record.countryCode, registryNamespace: record.registryNamespace } },
        update: {
          name: record.displayName, nameNormalized: record.normalizedName, healthProfessionId: healthProfession?.id ?? null,
          isVerified: record.isVerified, isActive: record.isActive, sourceReference: record.sourceReference,
        },
        create: {
          countryCode: record.countryCode, registryNamespace: record.registryNamespace, name: record.displayName,
          nameNormalized: record.normalizedName, healthProfessionId: healthProfession?.id ?? null,
          isVerified: record.isVerified, isActive: record.isActive, sourceReference: record.sourceReference,
        },
      });
    }
    for (const record of catalogs.institutions.records) {
      const institutionKey = `${record.countryCode}:${record.normalizedName}`;
      if (!mustWrite('Institution', institutionKey)) continue;
      await tx.institution.upsert({
        where: { countryCode_nameNormalized: { countryCode: record.countryCode, nameNormalized: record.normalizedName } },
        update: { name: record.displayName, isVerified: record.isVerified, isActive: record.isActive, sourceReference: record.sourceReference },
        create: {
          countryCode: record.countryCode, name: record.displayName, nameNormalized: record.normalizedName,
          isVerified: record.isVerified, isActive: record.isActive, sourceReference: record.sourceReference,
        },
      });
    }
    const mappings = mappingIndex(catalogs);
    const specialties = await readLegacySpecialties(tx, true);
    for (const specialty of specialties) {
      if (!mustWrite('Specialty', specialty.id)) continue;
      const mapping = (mappings.get(normalizeCatalogName(specialty.name)) ?? [])[0];
      if (!mapping) continue;
      const profession = await tx.healthProfession.findUniqueOrThrow({ where: { code: mapping.professionCode }, select: { id: true } });
      await tx.specialty.update({
        where: { id: specialty.id },
        data: {
          healthProfessionId: profession.id, code: mapping.specialtyCode,
          nameNormalized: mapping.normalizedName, isActive: mapping.isActive,
        },
      });
    }
    return plan;
  });
}
