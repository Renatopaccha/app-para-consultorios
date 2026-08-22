export const PROFESSIONAL_REVIEW_CAPABILITIES = [
  'PROFESSIONAL_REVIEW_READ',
  'PROFESSIONAL_REVIEW_DOCUMENT',
  'PROFESSIONAL_REVIEW_DECIDE',
] as const;

export type ProfessionalReviewCapability = (typeof PROFESSIONAL_REVIEW_CAPABILITIES)[number];

export const PROFESSIONAL_REVIEW_ACTIONS = ['APPROVE', 'REQUEST_CHANGES', 'REJECT'] as const;

export type ProfessionalReviewAction = (typeof PROFESSIONAL_REVIEW_ACTIONS)[number];

export type ProfessionalReviewApplicationState =
  | 'DRAFT'
  | 'PENDING_REVIEW'
  | 'NEEDS_CHANGES'
  | 'APPROVED'
  | 'REJECTED'
  | 'REOPENED';

export type ProfessionalReviewSubjectState =
  | ProfessionalReviewApplicationState
  | 'SUSPENDED'
  | 'REVOKED';

export type ProfessionalReviewTargetState = 'APPROVED' | 'NEEDS_CHANGES' | 'REJECTED';

export type ProfessionalReviewViolationCode =
  | 'APPLICATION_NOT_PENDING_REVIEW'
  | 'SELF_REVIEW_FORBIDDEN'
  | 'APPLICANT_MESSAGE_REQUIRED'
  | 'EXPECTED_REVISION_REQUIRED'
  | 'SNAPSHOT_ID_REQUIRED'
  | 'SNAPSHOT_MISSING_OR_MISMATCH'
  | 'SNAPSHOT_INTEGRITY_INVALID'
  | 'REQUIRED_DOCUMENT_NOT_CLEAN'
  | 'REQUIRED_DOCUMENT_MISSING'
  | 'DOCUMENT_EVIDENCE_NOT_RETAINED'
  | 'DOCTOR_PROFILE_PROVISIONING_NOT_READY'
  | 'PROFESSIONAL_ACCESS_PROVISIONING_CONFLICT'
  | 'DOCTOR_ROLE_ASSIGNMENT_CONFLICT'
  | 'LEGACY_ROLE_TRANSITION_CONFLICT'
  | 'UNSUPPORTED_SNAPSHOT_SCHEMA_VERSION';

export type ProfessionalReviewViolationTarget =
  | { type: 'APPLICATION'; id: string }
  | { type: 'SNAPSHOT'; id: string | null }
  | { type: 'CREDENTIAL'; id: string }
  | { type: 'DOCUMENT'; id: string }
  | { type: 'REVIEWER'; id: string }
  | { type: 'PROVISIONING'; id: string };

export interface ProfessionalReviewViolation {
  code: ProfessionalReviewViolationCode;
  target: ProfessionalReviewViolationTarget;
  field?: 'state' | 'applicantMessage' | 'expectedRevision' | 'snapshotId' | 'snapshot' | 'documents' | 'provisioning';
  message: string;
}

export interface ProfessionalReviewDecisionInput {
  applicationId: string;
  applicationStatus: ProfessionalReviewSubjectState;
  applicantUserId: string;
  reviewerUserId: string;
  action: ProfessionalReviewAction;
  expectedRevision?: number | null;
  snapshotId?: string | null;
  applicantMessage?: string | null;
  internalNote?: string | null;
}

export interface ProfessionalReviewDecisionResult {
  allowed: boolean;
  action: ProfessionalReviewAction;
  currentState: ProfessionalReviewSubjectState;
  targetState: ProfessionalReviewTargetState | null;
  requiresApplicantMessage: boolean;
  allowsInternalNote: boolean;
  requiresExpectedRevision: boolean;
  requiresSnapshotId: boolean;
  idempotent: boolean;
  violations: ProfessionalReviewViolation[];
}

export type ProfessionalCredentialReviewType =
  | 'PRIMARY_DEGREE'
  | 'SPECIALTY'
  | 'SUBSPECIALTY'
  | 'MASTER'
  | 'PHD'
  | 'OTHER_RELEVANT';

export interface SafeCredentialDocumentReviewMetadata {
  id: string;
  evidenceType: 'PRIMARY_EVIDENCE' | 'SUPPORTING_EVIDENCE';
  mimeType: string;
  format: string;
  sizeBytes: number;
  pageCount: number | null;
  width: number | null;
  height: number | null;
  reviewable: boolean;
  blocked: boolean;
}

export interface SafeCredentialReviewMetadata {
  id: string;
  credentialType: ProfessionalCredentialReviewType;
  isPrimary: boolean;
  title: string;
  institution: string;
  documents: SafeCredentialDocumentReviewMetadata[];
}

export interface SafeProfessionalApplicationReviewSummary {
  applicationId: string;
  status: ProfessionalReviewApplicationState;
  submittedAt: string | null;
  snapshotRevision: number | null;
  legalName: {
    givenNames: string;
    familyNames: string;
  };
  profession: {
    code: string;
    name: string;
  } | null;
  declaredSpecialties: Array<{
    id: string;
    name: string;
    isPrimary: boolean;
  }>;
}

export interface SafeProfessionalApplicationReviewDetail extends SafeProfessionalApplicationReviewSummary {
  credentials: SafeCredentialReviewMetadata[];
  location: {
    countryCode: string | null;
    administrativeArea1: string | null;
    city: string | null;
    street1: string | null;
  } | null;
}

export type SafeSnapshotIntegrityClassification =
  | 'VALID'
  | 'MISSING'
  | 'MISMATCH'
  | 'INVALID'
  | 'UNSUPPORTED_SCHEMA';

export interface SafeSnapshotIntegrityResult {
  valid: boolean;
  classification: SafeSnapshotIntegrityClassification;
  snapshotId: string | null;
  revision: number | null;
  schemaVersion: number | null;
  violations: ProfessionalReviewViolation[];
}

export type ProvisionableProfessionCode = 'MEDICINE' | 'DENTISTRY' | 'PSYCHOLOGY' | 'NURSING' | 'OTHER';

export interface ProvisioningReadinessResult {
  ready: boolean;
  professionCode: ProvisionableProfessionCode | null;
  violations: ProfessionalReviewViolation[];
}
