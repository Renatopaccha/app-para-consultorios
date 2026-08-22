import { createHash } from 'crypto';
import type {
  ProfessionalCredentialReviewType,
  ProfessionalReviewApplicationState,
  ProfessionalReviewDecisionInput,
  ProfessionalReviewDecisionResult,
  ProfessionalReviewTargetState,
  ProfessionalReviewViolation,
  ProvisionableProfessionCode,
  ProvisioningReadinessResult,
  SafeProfessionalApplicationReviewDetail,
  SafeProfessionalApplicationReviewSummary,
  SafeSnapshotIntegrityResult,
} from '../types/professionalApplicationReview';

export const PROFESSIONAL_APPROVAL_POLICY_VERSION = 'professional-approval-v1' as const;
export const SUPPORTED_PROFESSIONAL_SNAPSHOT_SCHEMA_VERSIONS = [1] as const;

const TARGET_STATE_BY_ACTION = {
  APPROVE: 'APPROVED',
  REQUEST_CHANGES: 'NEEDS_CHANGES',
  REJECT: 'REJECTED',
} as const satisfies Record<ProfessionalReviewDecisionInput['action'], ProfessionalReviewTargetState>;

const APPLICANT_MESSAGE_ACTIONS = new Set<ProfessionalReviewDecisionInput['action']>([
  'REQUEST_CHANGES',
  'REJECT',
]);

function applicationViolation(applicationId: string, message: string): ProfessionalReviewViolation {
  return {
    code: 'APPLICATION_NOT_PENDING_REVIEW',
    target: { type: 'APPLICATION', id: applicationId },
    field: 'state',
    message,
  };
}

/** Evaluates only the review transition contract. It performs no I/O and mutates no state. */
export function evaluateProfessionalReviewTransition(
  input: ProfessionalReviewDecisionInput,
): ProfessionalReviewDecisionResult {
  const violations: ProfessionalReviewViolation[] = [];
  const requiresApplicantMessage = APPLICANT_MESSAGE_ACTIONS.has(input.action);
  const targetState = input.applicationStatus === 'PENDING_REVIEW'
    ? TARGET_STATE_BY_ACTION[input.action]
    : null;

  if (input.applicationStatus !== 'PENDING_REVIEW') {
    const accessState = input.applicationStatus === 'SUSPENDED' || input.applicationStatus === 'REVOKED';
    violations.push(applicationViolation(
      input.applicationId,
      accessState
        ? 'Los estados de ProfessionalAccess no son estados revisables de una solicitud.'
        : 'Solo una solicitud pendiente de revisión puede recibir una decisión administrativa.',
    ));
  }
  if (input.reviewerUserId === input.applicantUserId) {
    violations.push({
      code: 'SELF_REVIEW_FORBIDDEN',
      target: { type: 'REVIEWER', id: input.reviewerUserId },
      message: 'Un revisor no puede decidir sobre su propia solicitud.',
    });
  }
  if (!Number.isInteger(input.expectedRevision) || Number(input.expectedRevision) < 1) {
    violations.push({
      code: 'EXPECTED_REVISION_REQUIRED',
      target: { type: 'APPLICATION', id: input.applicationId },
      field: 'expectedRevision',
      message: 'La revisión esperada de la solicitud es obligatoria.',
    });
  }
  if (typeof input.snapshotId !== 'string' || !input.snapshotId.trim()) {
    violations.push({
      code: 'SNAPSHOT_ID_REQUIRED',
      target: { type: 'SNAPSHOT', id: null },
      field: 'snapshotId',
      message: 'El snapshot sometido es obligatorio.',
    });
  }
  if (requiresApplicantMessage && (typeof input.applicantMessage !== 'string' || !input.applicantMessage.trim())) {
    violations.push({
      code: 'APPLICANT_MESSAGE_REQUIRED',
      target: { type: 'APPLICATION', id: input.applicationId },
      field: 'applicantMessage',
      message: 'La decisión requiere un mensaje visible para el profesional.',
    });
  }

  return {
    allowed: violations.length === 0,
    action: input.action,
    currentState: input.applicationStatus,
    targetState,
    requiresApplicantMessage,
    allowsInternalNote: true,
    requiresExpectedRevision: true,
    requiresSnapshotId: true,
    idempotent: true,
    violations,
  };
}

export interface SnapshotIntegrityInput {
  snapshot: {
    id: string;
    applicationId: string;
    revision: number;
    schemaVersion: number;
    payload: unknown;
    payloadHash: string;
  } | null;
  expectedApplicationId: string;
  expectedSnapshotId: string;
  expectedRevision: number;
  supportedSchemaVersions?: readonly number[];
}

/** Matches the canonical representation used by onboarding without exposing the source payload. */
export function canonicalProfessionalSnapshot(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'undefined';
  if (Array.isArray(value)) return `[${value.map(canonicalProfessionalSnapshot).join(',')}]`;
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record)
    .filter((key) => record[key] !== undefined)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${canonicalProfessionalSnapshot(record[key])}`)
    .join(',')}}`;
}

export function hashCanonicalProfessionalSnapshot(payload: unknown): string {
  return createHash('sha256').update(canonicalProfessionalSnapshot(payload)).digest('hex');
}

/** Classifies snapshot integrity and returns only safe identifiers and status. */
export function evaluateProfessionalSnapshotIntegrity(input: SnapshotIntegrityInput): SafeSnapshotIntegrityResult {
  if (!input.snapshot) {
    return {
      valid: false,
      classification: 'MISSING',
      snapshotId: null,
      revision: null,
      schemaVersion: null,
      violations: [{
        code: 'SNAPSHOT_MISSING_OR_MISMATCH',
        target: { type: 'SNAPSHOT', id: null },
        field: 'snapshot',
        message: 'No existe un snapshot sometido para esta decisión.',
      }],
    };
  }

  const safeBase = {
    snapshotId: input.snapshot.id,
    revision: input.snapshot.revision,
    schemaVersion: input.snapshot.schemaVersion,
  };
  const supported = input.supportedSchemaVersions ?? SUPPORTED_PROFESSIONAL_SNAPSHOT_SCHEMA_VERSIONS;
  if (!supported.includes(input.snapshot.schemaVersion)) {
    return {
      valid: false,
      classification: 'UNSUPPORTED_SCHEMA',
      ...safeBase,
      violations: [{
        code: 'UNSUPPORTED_SNAPSHOT_SCHEMA_VERSION',
        target: { type: 'SNAPSHOT', id: input.snapshot.id },
        field: 'snapshot',
        message: 'La versión del snapshot no está soportada por la política de revisión.',
      }],
    };
  }
  if (
    input.snapshot.id !== input.expectedSnapshotId
    || input.snapshot.applicationId !== input.expectedApplicationId
    || input.snapshot.revision !== input.expectedRevision
  ) {
    return {
      valid: false,
      classification: 'MISMATCH',
      ...safeBase,
      violations: [{
        code: 'SNAPSHOT_MISSING_OR_MISMATCH',
        target: { type: 'SNAPSHOT', id: input.snapshot.id },
        field: 'snapshot',
        message: 'El snapshot no corresponde a la entrega que se intenta revisar.',
      }],
    };
  }
  if (hashCanonicalProfessionalSnapshot(input.snapshot.payload) !== input.snapshot.payloadHash) {
    return {
      valid: false,
      classification: 'INVALID',
      ...safeBase,
      violations: [{
        code: 'SNAPSHOT_INTEGRITY_INVALID',
        target: { type: 'SNAPSHOT', id: input.snapshot.id },
        field: 'snapshot',
        message: 'No se pudo comprobar la integridad del snapshot sometido.',
      }],
    };
  }
  return { valid: true, classification: 'VALID', ...safeBase, violations: [] };
}

export type ExistingProfessionalAccessState =
  | 'NONE'
  | 'COMPATIBLE_ACTIVE'
  | 'INCOMPATIBLE'
  | 'SUSPENDED'
  | 'REVOKED';

export type ExistingDoctorRoleAssignmentState =
  | 'NONE'
  | 'COMPATIBLE_ACTIVE'
  | 'INCOMPATIBLE'
  | 'REVOKED';

export interface ProvisioningReadinessInput {
  applicantUserId: string;
  healthProfessionCode: string | null;
  professionCodeMapping: Readonly<Partial<Record<string, ProvisionableProfessionCode>>>;
  retainedSnapshotEvidence: boolean;
  licenseNumber: string | null;
  licenseNumberPolicyAllowsValue: boolean;
  consultationPrice: number | null;
  consultationPricePolicyDefined: boolean;
  doctorProfileModel: {
    requiresLicenseNumber: boolean;
    requiresConsultationPrice: boolean;
    existingProfileState: 'NONE' | 'COMPATIBLE' | 'INCOMPATIBLE';
  };
  professionalAccessState: ExistingProfessionalAccessState;
  doctorRoleAssignmentState: ExistingDoctorRoleAssignmentState;
  legacyUserRole: 'SUPER_ADMIN' | 'CLINIC_ADMIN' | 'DOCTOR' | 'ASSISTANT' | 'PATIENT';
}

function provisioningViolation(
  code: ProfessionalReviewViolation['code'],
  applicantUserId: string,
  message: string,
): ProfessionalReviewViolation {
  return {
    code,
    target: { type: 'PROVISIONING', id: applicantUserId },
    field: 'provisioning',
    message,
  };
}

/** Fails closed when current DoctorProfile/access/role requirements cannot be satisfied without invented data. */
export function evaluateProfessionalProvisioningReadiness(
  input: ProvisioningReadinessInput,
): ProvisioningReadinessResult {
  const violations: ProfessionalReviewViolation[] = [];
  const mappedProfession = input.healthProfessionCode
    ? input.professionCodeMapping[input.healthProfessionCode] ?? null
    : null;
  const hasValidLicense = typeof input.licenseNumber === 'string'
    && input.licenseNumber.trim().length >= 2
    && input.licenseNumber.trim().length <= 120
    && input.licenseNumberPolicyAllowsValue;
  const hasValidPrice = typeof input.consultationPrice === 'number'
    && Number.isFinite(input.consultationPrice)
    && input.consultationPrice >= 0
    && input.consultationPricePolicyDefined;

  if (!input.retainedSnapshotEvidence) {
    violations.push(provisioningViolation(
      'DOCUMENT_EVIDENCE_NOT_RETAINED',
      input.applicantUserId,
      'La evidencia del snapshot no tiene retención verificable.',
    ));
  }
  if (!mappedProfession) {
    violations.push(provisioningViolation(
      'DOCTOR_PROFILE_PROVISIONING_NOT_READY',
      input.applicantUserId,
      'No existe un mapeo explícito para la profesión aprobada.',
    ));
  }
  if (input.doctorProfileModel.requiresLicenseNumber && !hasValidLicense) {
    violations.push(provisioningViolation(
      'DOCTOR_PROFILE_PROVISIONING_NOT_READY',
      input.applicantUserId,
      'No existe un número profesional válido y permitido para crear DoctorProfile.',
    ));
  }
  if (input.doctorProfileModel.requiresConsultationPrice && !hasValidPrice) {
    violations.push(provisioningViolation(
      'DOCTOR_PROFILE_PROVISIONING_NOT_READY',
      input.applicantUserId,
      'No existe un precio válido respaldado por una política de aprovisionamiento.',
    ));
  }
  if (input.doctorProfileModel.existingProfileState === 'INCOMPATIBLE') {
    violations.push(provisioningViolation(
      'DOCTOR_PROFILE_PROVISIONING_NOT_READY',
      input.applicantUserId,
      'El DoctorProfile existente no es compatible con la solicitud.',
    ));
  }
  if (!['NONE', 'COMPATIBLE_ACTIVE'].includes(input.professionalAccessState)) {
    violations.push(provisioningViolation(
      'PROFESSIONAL_ACCESS_PROVISIONING_CONFLICT',
      input.applicantUserId,
      'El estado existente de ProfessionalAccess requiere resolución administrativa.',
    ));
  }
  if (!['NONE', 'COMPATIBLE_ACTIVE'].includes(input.doctorRoleAssignmentState)) {
    violations.push(provisioningViolation(
      'DOCTOR_ROLE_ASSIGNMENT_CONFLICT',
      input.applicantUserId,
      'La asignación DOCTOR existente requiere resolución administrativa.',
    ));
  }
  if (input.legacyUserRole !== 'PATIENT' && input.legacyUserRole !== 'DOCTOR') {
    violations.push(provisioningViolation(
      'LEGACY_ROLE_TRANSITION_CONFLICT',
      input.applicantUserId,
      'El rol legacy no admite una transición automática segura a DOCTOR.',
    ));
  }

  return { ready: violations.length === 0, professionCode: mappedProfession, violations };
}

export interface ProfessionalApprovalDocumentManifest {
  id: string;
  active: boolean;
  requiredForApproval: boolean;
  retainedSnapshotId: string | null;
  scanStatus: 'PENDING' | 'CLEAN' | 'REJECTED' | 'ERROR';
}

export interface ProfessionalApprovalManifest {
  application: {
    id: string;
    userId: string;
    status: ProfessionalReviewApplicationState;
    currentRevision: number;
    submittedSnapshotId: string;
  };
  reviewer: { userId: string };
  snapshot: SnapshotIntegrityInput['snapshot'];
  requiredCredentials: Array<{
    id: string;
    credentialType: ProfessionalCredentialReviewType;
    required: boolean;
    documents: ProfessionalApprovalDocumentManifest[];
  }>;
  provisioning: ProvisioningReadinessInput;
}

export interface ProfessionalApprovalEvaluation {
  policyVersion: typeof PROFESSIONAL_APPROVAL_POLICY_VERSION;
  eligible: boolean;
  violations: ProfessionalReviewViolation[];
  snapshotIntegrity: SafeSnapshotIntegrityResult;
  provisioningReadiness: ProvisioningReadinessResult;
}

/** Evaluates future approval eligibility from a pre-built manifest and performs no reads or writes. */
export function evaluateProfessionalApprovalPolicy(
  manifest: ProfessionalApprovalManifest,
): ProfessionalApprovalEvaluation {
  const violations: ProfessionalReviewViolation[] = [];
  if (manifest.application.status !== 'PENDING_REVIEW') {
    violations.push(applicationViolation(
      manifest.application.id,
      'La solicitud no está pendiente de revisión.',
    ));
  }
  if (manifest.reviewer.userId === manifest.application.userId) {
    violations.push({
      code: 'SELF_REVIEW_FORBIDDEN',
      target: { type: 'REVIEWER', id: manifest.reviewer.userId },
      message: 'Un revisor no puede decidir sobre su propia solicitud.',
    });
  }

  const snapshotIntegrity = evaluateProfessionalSnapshotIntegrity({
    snapshot: manifest.snapshot,
    expectedApplicationId: manifest.application.id,
    expectedSnapshotId: manifest.application.submittedSnapshotId,
    expectedRevision: manifest.application.currentRevision,
  });
  violations.push(...snapshotIntegrity.violations);

  for (const credential of manifest.requiredCredentials.filter((item) => item.required)) {
    const documents = credential.documents.filter((document) => document.active && document.requiredForApproval);
    if (documents.length === 0) {
      violations.push({
        code: 'REQUIRED_DOCUMENT_MISSING',
        target: { type: 'CREDENTIAL', id: credential.id },
        field: 'documents',
        message: 'La credencial requerida no tiene evidencia documental activa.',
      });
      continue;
    }
    for (const document of documents) {
      if (document.retainedSnapshotId !== manifest.application.submittedSnapshotId) {
        violations.push({
          code: 'DOCUMENT_EVIDENCE_NOT_RETAINED',
          target: { type: 'DOCUMENT', id: document.id },
          field: 'documents',
          message: 'La evidencia documental no está retenida para el snapshot sometido.',
        });
      }
      if (document.scanStatus !== 'CLEAN') {
        violations.push({
          code: 'REQUIRED_DOCUMENT_NOT_CLEAN',
          target: { type: 'DOCUMENT', id: document.id },
          field: 'documents',
          message: 'El documento requerido no ha superado la política de seguridad.',
        });
      }
    }
  }

  const provisioningReadiness = evaluateProfessionalProvisioningReadiness(manifest.provisioning);
  violations.push(...provisioningReadiness.violations);
  return {
    policyVersion: PROFESSIONAL_APPROVAL_POLICY_VERSION,
    eligible: violations.length === 0,
    violations,
    snapshotIntegrity,
    provisioningReadiness,
  };
}

export interface ProfessionalReviewProjectionManifest {
  application: {
    id: string;
    status: ProfessionalReviewApplicationState;
    submittedAt: Date | string | null;
    legalGivenNames: string | null;
    legalFamilyNames: string | null;
  };
  snapshot: { revision: number } | null;
  profession: { code: string; name: string } | null;
  declaredSpecialties: Array<{ id: string; name: string; isPrimary: boolean }>;
  credentials: Array<{
    id: string;
    credentialType: ProfessionalCredentialReviewType;
    isPrimary: boolean;
    exactTitle: string;
    institutionName: string;
    documents: Array<{
      id: string;
      evidenceType: 'PRIMARY_EVIDENCE' | 'SUPPORTING_EVIDENCE';
      mimeType: string;
      format: string;
      sizeBytes: number;
      pageCount?: number | null;
      width?: number | null;
      height?: number | null;
      active: boolean;
      evidenceRetainedForSnapshot: boolean;
      scanStatus: 'PENDING' | 'CLEAN' | 'REJECTED' | 'ERROR';
    }>;
  }>;
  location: {
    countryCode: string | null;
    administrativeArea1: string | null;
    city: string | null;
    street1: string | null;
  } | null;
}

function submittedAtString(value: Date | string | null): string | null {
  if (value instanceof Date) return value.toISOString();
  return value;
}

/** Projects the minimal queue data without carrying raw snapshots or document internals. */
export function toSafeProfessionalApplicationReviewSummary(
  manifest: ProfessionalReviewProjectionManifest,
): SafeProfessionalApplicationReviewSummary {
  return {
    applicationId: manifest.application.id,
    status: manifest.application.status,
    submittedAt: submittedAtString(manifest.application.submittedAt),
    snapshotRevision: manifest.snapshot?.revision ?? null,
    legalName: {
      givenNames: manifest.application.legalGivenNames?.trim() ?? '',
      familyNames: manifest.application.legalFamilyNames?.trim() ?? '',
    },
    profession: manifest.profession ? { code: manifest.profession.code, name: manifest.profession.name } : null,
    declaredSpecialties: manifest.declaredSpecialties.map((specialty) => ({
      id: specialty.id,
      name: specialty.name,
      isPrimary: specialty.isPrimary,
    })),
  };
}

/** Projects review detail and reduces scan state to reviewable/blocked booleans. */
export function toSafeProfessionalApplicationReviewDetail(
  manifest: ProfessionalReviewProjectionManifest,
): SafeProfessionalApplicationReviewDetail {
  return {
    ...toSafeProfessionalApplicationReviewSummary(manifest),
    credentials: manifest.credentials.map((credential) => ({
      id: credential.id,
      credentialType: credential.credentialType,
      isPrimary: credential.isPrimary,
      title: credential.exactTitle,
      institution: credential.institutionName,
      documents: credential.documents.map((document) => {
        const reviewable = document.active
          && document.evidenceRetainedForSnapshot
          && document.scanStatus === 'CLEAN';
        return {
          id: document.id,
          evidenceType: document.evidenceType,
          mimeType: document.mimeType,
          format: document.format,
          sizeBytes: document.sizeBytes,
          pageCount: document.pageCount ?? null,
          width: document.width ?? null,
          height: document.height ?? null,
          reviewable,
          blocked: !reviewable,
        };
      }),
    })),
    location: manifest.location ? {
      countryCode: manifest.location.countryCode,
      administrativeArea1: manifest.location.administrativeArea1,
      city: manifest.location.city,
      street1: manifest.location.street1,
    } : null,
  };
}
