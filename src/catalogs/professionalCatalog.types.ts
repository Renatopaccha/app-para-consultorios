export type CatalogDecisionStatus = 'APPROVED_FOR_IMPORT' | 'PENDING_CATALOG_DECISION';

export interface CatalogEnvelope<T> {
  schemaVersion: 1;
  catalogVersion: string;
  source: string;
  publishedAt: string;
  records: T[];
}

export interface ProfessionCatalogRecord {
  code: string;
  displayName: string;
  normalizedName: string;
  isActive: boolean;
  requiresSpecialty: boolean;
  credentialPolicyVersion: number;
  sortOrder: number;
}

export interface LanguageCatalogRecord {
  code: string;
  displayName: string;
  normalizedName: string;
  isActive: boolean;
  sortOrder: number;
}

export interface RegistrationAuthorityCatalogRecord {
  countryCode: string;
  registryNamespace: string;
  displayName: string;
  normalizedName: string;
  healthProfessionCode: string | null;
  isVerified: boolean;
  isActive: boolean;
  sourceReference: string;
  decisionStatus: CatalogDecisionStatus;
  pendingDecision: string | null;
}

export interface InstitutionCatalogRecord {
  countryCode: string;
  displayName: string;
  normalizedName: string;
  isVerified: boolean;
  isActive: boolean;
  sourceReference: string | null;
}

export interface SpecialtyMappingCatalogRecord {
  professionCode: string;
  specialtyCode: string;
  displayName: string;
  normalizedName: string;
  legacyNormalizedNames: string[];
  isActive: boolean;
  sortOrder: number;
  source: string;
  sourceVersion: string;
}

export interface CatalogChecksums {
  algorithm: 'sha256';
  files: Record<string, string>;
}

export interface LoadedProfessionalCatalogs {
  professions: CatalogEnvelope<ProfessionCatalogRecord>;
  languages: CatalogEnvelope<LanguageCatalogRecord>;
  registrationAuthorities: CatalogEnvelope<RegistrationAuthorityCatalogRecord>;
  institutions: CatalogEnvelope<InstitutionCatalogRecord>;
  specialties: CatalogEnvelope<SpecialtyMappingCatalogRecord>;
  checksums: Record<string, string>;
}

export interface CatalogAction {
  entity: string;
  key: string;
  operation: 'CREATE' | 'UPDATE' | 'UNCHANGED' | 'SKIP_PENDING_DECISION';
  changes?: Record<string, { from: unknown; to: unknown }>;
}

export interface SpecialtyAuditEntry {
  id: string;
  name: string;
  normalizedName: string;
  doctorProfiles: number;
  clinicProfiles: number;
  classification: string;
  proposedCode: string | null;
  status: 'MAPPED' | 'ALREADY_MAPPED' | 'UNMAPPED_REQUIRES_REVIEW';
}

export interface ProfessionalCatalogPlan {
  mode: 'DRY_RUN' | 'APPLY';
  database: { environment: string; databaseName: string };
  prerequisites: { ready: boolean; missing: string[] };
  checksums: Record<string, string>;
  actions: CatalogAction[];
  specialtyAudit: SpecialtyAuditEntry[];
  conflicts: string[];
  warnings: string[];
  summary: {
    creates: number;
    updates: number;
    unchanged: number;
    pendingDecisions: number;
    unmappedSpecialties: number;
  };
}
