import { isPrivateOnboardingCredentialDocument } from './professionalOnboardingDocumentPolicy';

export const CREDENTIAL_SUBMIT_POLICY_VERSION = 'credential-submit-v1' as const;

export type CredentialSubmitViolationCode =
  | 'PRIMARY_CREDENTIAL_REQUIRED'
  | 'MULTIPLE_PRIMARY_CREDENTIALS'
  | 'PRIMARY_CREDENTIAL_DOCUMENT_REQUIRED'
  | 'SPECIALTY_CREDENTIAL_REQUIRED'
  | 'SPECIALTY_CREDENTIAL_DOCUMENT_REQUIRED';

export type CredentialSubmitViolationTarget =
  | { type: 'APPLICATION'; id: string }
  | { type: 'CREDENTIAL'; id: string };

export interface CredentialSubmitViolation {
  code: CredentialSubmitViolationCode;
  target: CredentialSubmitViolationTarget;
  field: 'credentials' | 'documents';
  message: string;
}

export interface CredentialSubmitManifest {
  applicationId: string;
  userId: string;
  declaredSpecialtyCount: number;
  credentials: Array<{
    applicationId: string;
    credentialId: string;
    credentialUserId: string;
    credentialType: 'PRIMARY_DEGREE' | 'SPECIALTY' | 'SUBSPECIALTY' | 'MASTER' | 'PHD' | 'OTHER_RELEVANT';
    isPrimary: boolean;
    deletedAt: Date | null;
    documents: Array<{
      credentialId: string;
      storageProvider: string;
      publicId: string;
      resourceType: string;
      format: string;
      mimeType: string;
      scanStatus: 'PENDING' | 'CLEAN' | 'REJECTED' | 'ERROR';
      deletedAt: Date | null;
    }>;
  }>;
}

const ELIGIBLE_SCAN_STATUSES = new Set(['PENDING', 'CLEAN']);

function applicationTarget(manifest: CredentialSubmitManifest): CredentialSubmitViolationTarget {
  return { type: 'APPLICATION', id: manifest.applicationId };
}

function credentialTarget(credentialId: string): CredentialSubmitViolationTarget {
  return { type: 'CREDENTIAL', id: credentialId };
}

function hasEligibleDocument(credential: CredentialSubmitManifest['credentials'][number]): boolean {
  return credential.documents.some((document) => (
    document.credentialId === credential.credentialId
    && document.deletedAt === null
    && ELIGIBLE_SCAN_STATUSES.has(document.scanStatus)
    && isPrivateOnboardingCredentialDocument({
      credentialId: credential.credentialId,
      storageProvider: document.storageProvider,
      publicId: document.publicId,
      resourceType: document.resourceType,
      format: document.format,
      mimeType: document.mimeType,
    })
  ));
}

/** Pure credential-submit-v1 policy evaluator. It performs no I/O and returns only safe UI data. */
export function evaluateCredentialSubmitPolicy(manifest: CredentialSubmitManifest): CredentialSubmitViolation[] {
  const violations: CredentialSubmitViolation[] = [];
  const activeOwnedCredentials = manifest.credentials.filter((credential) => (
    credential.applicationId === manifest.applicationId
    && credential.credentialUserId === manifest.userId
    && credential.deletedAt === null
  ));
  const primaryCredentials = activeOwnedCredentials.filter((credential) => credential.isPrimary);

  if (primaryCredentials.length === 0) {
    violations.push({
      code: 'PRIMARY_CREDENTIAL_REQUIRED',
      target: applicationTarget(manifest),
      field: 'credentials',
      message: 'Agrega un título profesional principal.',
    });
  } else if (primaryCredentials.length > 1) {
    violations.push({
      code: 'MULTIPLE_PRIMARY_CREDENTIALS',
      target: applicationTarget(manifest),
      field: 'credentials',
      message: 'Selecciona un solo título profesional principal.',
    });
  } else {
    const primary = primaryCredentials[0]!;
    if (primary.credentialType !== 'PRIMARY_DEGREE') {
      violations.push({
        code: 'PRIMARY_CREDENTIAL_REQUIRED',
        target: applicationTarget(manifest),
        field: 'credentials',
        message: 'La credencial principal debe ser tu título profesional de grado.',
      });
    } else if (!hasEligibleDocument(primary)) {
      violations.push({
        code: 'PRIMARY_CREDENTIAL_DOCUMENT_REQUIRED',
        target: credentialTarget(primary.credentialId),
        field: 'documents',
        message: 'Adjunta al menos un documento de respaldo para tu título profesional principal.',
      });
    }
  }

  if (manifest.declaredSpecialtyCount > 0) {
    const specialtyCredentials = activeOwnedCredentials.filter((credential) => credential.credentialType === 'SPECIALTY');
    if (specialtyCredentials.length === 0) {
      violations.push({
        code: 'SPECIALTY_CREDENTIAL_REQUIRED',
        target: applicationTarget(manifest),
        field: 'credentials',
        message: 'Agrega una credencial de especialidad.',
      });
    } else if (!specialtyCredentials.some(hasEligibleDocument)) {
      violations.push({
        code: 'SPECIALTY_CREDENTIAL_DOCUMENT_REQUIRED',
        target: applicationTarget(manifest),
        field: 'documents',
        message: 'Adjunta al menos un documento de respaldo para una credencial de especialidad.',
      });
    }
  }

  return violations;
}
