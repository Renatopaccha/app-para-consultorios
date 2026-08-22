import type {
  ProfessionalReviewAction,
  ProfessionalReviewSubjectState,
} from '../types/professionalApplicationReview';
import {
  evaluateProfessionalApprovalPolicy,
  evaluateProfessionalProvisioningReadiness,
  evaluateProfessionalReviewTransition,
  evaluateProfessionalSnapshotIntegrity,
  hashCanonicalProfessionalSnapshot,
  PROFESSIONAL_APPROVAL_POLICY_VERSION,
  type ProfessionalApprovalManifest,
  type ProfessionalReviewProjectionManifest,
  toSafeProfessionalApplicationReviewDetail,
  toSafeProfessionalApplicationReviewSummary,
} from './professionalApplicationReviewPolicy';

const APPLICATION_ID = '11111111-1111-4111-8111-111111111111';
const APPLICANT_ID = '22222222-2222-4222-8222-222222222222';
const REVIEWER_ID = '33333333-3333-4333-8333-333333333333';
const SNAPSHOT_ID = '44444444-4444-4444-8444-444444444444';
const CREDENTIAL_ID = '55555555-5555-4555-8555-555555555555';
const DOCUMENT_ID = '66666666-6666-4666-8666-666666666666';
const SNAPSHOT_PAYLOAD = { schemaVersion: 1, revision: 7, application: { id: APPLICATION_ID } };

function decision(
  state: ProfessionalReviewSubjectState,
  action: ProfessionalReviewAction,
  overrides: Partial<Parameters<typeof evaluateProfessionalReviewTransition>[0]> = {},
) {
  return evaluateProfessionalReviewTransition({
    applicationId: APPLICATION_ID,
    applicationStatus: state,
    applicantUserId: APPLICANT_ID,
    reviewerUserId: REVIEWER_ID,
    action,
    expectedRevision: 7,
    snapshotId: SNAPSHOT_ID,
    applicantMessage: action === 'APPROVE' ? null : 'Mensaje visible para el profesional.',
    ...overrides,
  });
}

function provisioning(overrides: Partial<Parameters<typeof evaluateProfessionalProvisioningReadiness>[0]> = {}) {
  return {
    applicantUserId: APPLICANT_ID,
    healthProfessionCode: 'MEDICINE',
    professionCodeMapping: { MEDICINE: 'MEDICINE' as const },
    retainedSnapshotEvidence: true,
    licenseNumber: 'PROF-123',
    licenseNumberPolicyAllowsValue: true,
    consultationPrice: 40,
    consultationPricePolicyDefined: true,
    doctorProfileModel: {
      requiresLicenseNumber: true,
      requiresConsultationPrice: true,
      existingProfileState: 'NONE' as const,
    },
    professionalAccessState: 'NONE' as const,
    doctorRoleAssignmentState: 'NONE' as const,
    legacyUserRole: 'PATIENT' as const,
    ...overrides,
  };
}

function approval(overrides: Partial<ProfessionalApprovalManifest> = {}): ProfessionalApprovalManifest {
  return {
    application: {
      id: APPLICATION_ID,
      userId: APPLICANT_ID,
      status: 'PENDING_REVIEW',
      currentRevision: 7,
      submittedSnapshotId: SNAPSHOT_ID,
    },
    reviewer: { userId: REVIEWER_ID },
    snapshot: {
      id: SNAPSHOT_ID,
      applicationId: APPLICATION_ID,
      revision: 7,
      schemaVersion: 1,
      payload: SNAPSHOT_PAYLOAD,
      payloadHash: hashCanonicalProfessionalSnapshot(SNAPSHOT_PAYLOAD),
    },
    requiredCredentials: [{
      id: CREDENTIAL_ID,
      credentialType: 'PRIMARY_DEGREE',
      required: true,
      documents: [{
        id: DOCUMENT_ID,
        active: true,
        requiredForApproval: true,
        retainedSnapshotId: SNAPSHOT_ID,
        scanStatus: 'CLEAN',
      }],
    }],
    provisioning: provisioning(),
    ...overrides,
  };
}

describe('professional review state machine', () => {
  const actions = ['APPROVE', 'REQUEST_CHANGES', 'REJECT'] as const;
  const invalidStates = ['DRAFT', 'NEEDS_CHANGES', 'APPROVED', 'REJECTED', 'REOPENED', 'SUSPENDED', 'REVOKED'] as const;

  it.each([
    ['APPROVE', 'APPROVED'],
    ['REQUEST_CHANGES', 'NEEDS_CHANGES'],
    ['REJECT', 'REJECTED'],
  ] as const)('permite PENDING_REVIEW + %s → %s', (action, targetState) => {
    expect(decision('PENDING_REVIEW', action)).toMatchObject({
      allowed: true,
      targetState,
      requiresExpectedRevision: true,
      requiresSnapshotId: true,
      idempotent: true,
    });
  });

  it.each(invalidStates.flatMap((state) => actions.map((action) => [state, action] as const)))(
    'rechaza la decisión %s/%s fuera de PENDING_REVIEW',
    (state, action) => {
      expect(decision(state, action)).toMatchObject({
        allowed: false,
        targetState: null,
        violations: expect.arrayContaining([expect.objectContaining({ code: 'APPLICATION_NOT_PENDING_REVIEW' })]),
      });
    },
  );

  it('prohíbe auto-revisión', () => {
    expect(decision('PENDING_REVIEW', 'APPROVE', { reviewerUserId: APPLICANT_ID })).toMatchObject({
      allowed: false,
      violations: expect.arrayContaining([expect.objectContaining({ code: 'SELF_REVIEW_FORBIDDEN' })]),
    });
  });

  it('REQUEST_CHANGES exige applicantMessage y nunca exige nota interna', () => {
    const result = decision('PENDING_REVIEW', 'REQUEST_CHANGES', { applicantMessage: '  ' });
    expect(result).toMatchObject({
      allowed: false,
      requiresApplicantMessage: true,
      allowsInternalNote: true,
      violations: expect.arrayContaining([expect.objectContaining({ code: 'APPLICANT_MESSAGE_REQUIRED' })]),
    });
    expect(decision('PENDING_REVIEW', 'APPROVE')).toMatchObject({ requiresApplicantMessage: false, allowed: true });
  });

  it('exige expectedRevision y snapshotId', () => {
    expect(decision('PENDING_REVIEW', 'APPROVE', { expectedRevision: null, snapshotId: '' }).violations)
      .toEqual(expect.arrayContaining([
        expect.objectContaining({ code: 'EXPECTED_REVISION_REQUIRED' }),
        expect.objectContaining({ code: 'SNAPSHOT_ID_REQUIRED' }),
      ]));
  });
});

describe('professional snapshot integrity', () => {
  const base = approval().snapshot!;

  it('acepta hash canonical sin depender del orden de claves', () => {
    const first = { z: 1, nested: { b: true, a: ['x'] } };
    const second = { nested: { a: ['x'], b: true }, z: 1 };
    expect(hashCanonicalProfessionalSnapshot(first)).toBe(hashCanonicalProfessionalSnapshot(second));
  });

  it('no devuelve el payload ni el hash en el resultado seguro', () => {
    const result = evaluateProfessionalSnapshotIntegrity({
      snapshot: base,
      expectedApplicationId: APPLICATION_ID,
      expectedSnapshotId: SNAPSHOT_ID,
      expectedRevision: 7,
    });
    expect(result).toMatchObject({ valid: true, classification: 'VALID' });
    expect(JSON.stringify(result)).not.toMatch(/payload|hash|secret-value/i);
  });

  it('rechaza snapshot ausente, alterado o no correspondiente', () => {
    expect(evaluateProfessionalSnapshotIntegrity({
      snapshot: null,
      expectedApplicationId: APPLICATION_ID,
      expectedSnapshotId: SNAPSHOT_ID,
      expectedRevision: 7,
    }).violations).toContainEqual(expect.objectContaining({ code: 'SNAPSHOT_MISSING_OR_MISMATCH' }));

    expect(evaluateProfessionalSnapshotIntegrity({
      snapshot: { ...base, payload: { tampered: true } },
      expectedApplicationId: APPLICATION_ID,
      expectedSnapshotId: SNAPSHOT_ID,
      expectedRevision: 7,
    }).violations).toContainEqual(expect.objectContaining({ code: 'SNAPSHOT_INTEGRITY_INVALID' }));

    expect(evaluateProfessionalSnapshotIntegrity({
      snapshot: { ...base, revision: 6 },
      expectedApplicationId: APPLICATION_ID,
      expectedSnapshotId: SNAPSHOT_ID,
      expectedRevision: 7,
    }).violations).toContainEqual(expect.objectContaining({ code: 'SNAPSHOT_MISSING_OR_MISMATCH' }));
  });

  it('rechaza schema version desconocida', () => {
    expect(evaluateProfessionalSnapshotIntegrity({
      snapshot: { ...base, schemaVersion: 99 },
      expectedApplicationId: APPLICATION_ID,
      expectedSnapshotId: SNAPSHOT_ID,
      expectedRevision: 7,
    })).toMatchObject({
      valid: false,
      classification: 'UNSUPPORTED_SCHEMA',
      violations: [expect.objectContaining({ code: 'UNSUPPORTED_SNAPSHOT_SCHEMA_VERSION' })],
    });
  });
});

describe(PROFESSIONAL_APPROVAL_POLICY_VERSION, () => {
  it('CLEAN es elegible únicamente cuando todas las demás precondiciones se satisfacen', () => {
    expect(evaluateProfessionalApprovalPolicy(approval())).toMatchObject({
      policyVersion: PROFESSIONAL_APPROVAL_POLICY_VERSION,
      eligible: true,
      violations: [],
      provisioningReadiness: { ready: true },
      snapshotIntegrity: { valid: true },
    });
  });

  it.each(['PENDING', 'REJECTED', 'ERROR'] as const)('%s bloquea aprobación', (scanStatus) => {
    const manifest = approval();
    manifest.requiredCredentials[0]!.documents[0]!.scanStatus = scanStatus;
    expect(evaluateProfessionalApprovalPolicy(manifest)).toMatchObject({
      eligible: false,
      violations: expect.arrayContaining([expect.objectContaining({ code: 'REQUIRED_DOCUMENT_NOT_CLEAN' })]),
    });
  });

  it('documento ausente y evidencia no retenida bloquean con códigos distintos', () => {
    const missing = approval();
    missing.requiredCredentials[0]!.documents = [];
    expect(evaluateProfessionalApprovalPolicy(missing).violations)
      .toContainEqual(expect.objectContaining({ code: 'REQUIRED_DOCUMENT_MISSING' }));

    const unretained = approval();
    unretained.requiredCredentials[0]!.documents[0]!.retainedSnapshotId = null;
    expect(evaluateProfessionalApprovalPolicy(unretained).violations)
      .toContainEqual(expect.objectContaining({ code: 'DOCUMENT_EVIDENCE_NOT_RETAINED' }));
  });

  it('rechaza application no pendiente y auto-revisión', () => {
    const manifest = approval({
      application: { ...approval().application, status: 'DRAFT' },
      reviewer: { userId: APPLICANT_ID },
    });
    expect(evaluateProfessionalApprovalPolicy(manifest).violations).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: 'APPLICATION_NOT_PENDING_REVIEW' }),
      expect.objectContaining({ code: 'SELF_REVIEW_FORBIDDEN' }),
    ]));
  });
});

describe('professional provisioning readiness', () => {
  it('falla sin licenseNumber, precio/política, evidencia o mapeo', () => {
    const result = evaluateProfessionalProvisioningReadiness(provisioning({
      retainedSnapshotEvidence: false,
      healthProfessionCode: 'UNMAPPED',
      licenseNumber: null,
      consultationPrice: null,
      consultationPricePolicyDefined: false,
    }));
    expect(result).toMatchObject({ ready: false, professionCode: null });
    expect(result.violations).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: 'DOCUMENT_EVIDENCE_NOT_RETAINED' }),
      expect.objectContaining({ code: 'DOCTOR_PROFILE_PROVISIONING_NOT_READY' }),
    ]));
    expect(result.violations.filter(({ code }) => code === 'DOCTOR_PROFILE_PROVISIONING_NOT_READY')).toHaveLength(3);
  });

  it.each(['INCOMPATIBLE', 'SUSPENDED', 'REVOKED'] as const)('bloquea Access %s', (professionalAccessState) => {
    expect(evaluateProfessionalProvisioningReadiness(provisioning({ professionalAccessState })).violations)
      .toContainEqual(expect.objectContaining({ code: 'PROFESSIONAL_ACCESS_PROVISIONING_CONFLICT' }));
  });

  it.each(['INCOMPATIBLE', 'REVOKED'] as const)('bloquea assignment %s', (doctorRoleAssignmentState) => {
    expect(evaluateProfessionalProvisioningReadiness(provisioning({ doctorRoleAssignmentState })).violations)
      .toContainEqual(expect.objectContaining({ code: 'DOCTOR_ROLE_ASSIGNMENT_CONFLICT' }));
  });

  it.each(['SUPER_ADMIN', 'CLINIC_ADMIN', 'ASSISTANT'] as const)('bloquea transición legacy desde %s', (legacyUserRole) => {
    expect(evaluateProfessionalProvisioningReadiness(provisioning({ legacyUserRole })).violations)
      .toContainEqual(expect.objectContaining({ code: 'LEGACY_ROLE_TRANSITION_CONFLICT' }));
  });

  it('permite PATIENT o DOCTOR cuando el perfil y las demás piezas son compatibles', () => {
    expect(evaluateProfessionalProvisioningReadiness(provisioning())).toMatchObject({ ready: true, professionCode: 'MEDICINE', violations: [] });
    expect(evaluateProfessionalProvisioningReadiness(provisioning({
      legacyUserRole: 'DOCTOR',
      doctorProfileModel: { requiresLicenseNumber: true, requiresConsultationPrice: true, existingProfileState: 'COMPATIBLE' },
      professionalAccessState: 'COMPATIBLE_ACTIVE',
      doctorRoleAssignmentState: 'COMPATIBLE_ACTIVE',
    }))).toMatchObject({ ready: true, professionCode: 'MEDICINE', violations: [] });
  });
});

describe('safe professional review DTOs', () => {
  function projection(): ProfessionalReviewProjectionManifest {
    return {
      application: {
        id: APPLICATION_ID,
        status: 'PENDING_REVIEW',
        submittedAt: new Date('2026-08-21T10:00:00.000Z'),
        legalGivenNames: 'Ana',
        legalFamilyNames: 'Pérez',
      },
      snapshot: { revision: 7 },
      profession: { code: 'MEDICINE', name: 'Medicina' },
      declaredSpecialties: [{ id: 'specialty-id', name: 'Cardiología', isPrimary: true }],
      credentials: [{
        id: CREDENTIAL_ID,
        credentialType: 'PRIMARY_DEGREE',
        isPrimary: true,
        exactTitle: 'Médico',
        institutionName: 'Universidad de prueba',
        documents: [{
          id: DOCUMENT_ID,
          evidenceType: 'PRIMARY_EVIDENCE',
          mimeType: 'application/pdf',
          format: 'pdf',
          sizeBytes: 1024,
          pageCount: 2,
          width: null,
          height: null,
          active: true,
          evidenceRetainedForSnapshot: true,
          scanStatus: 'CLEAN',
          publicId: 'forbidden-public-id',
          storageProvider: 'cloudinary',
          checksumSha256: 'f'.repeat(64),
          signedUrl: 'https://forbidden.test/signed',
        } as ProfessionalReviewProjectionManifest['credentials'][number]['documents'][number]],
        registrationNumber: 'forbidden-registration-number',
      } as ProfessionalReviewProjectionManifest['credentials'][number]],
      location: { countryCode: 'EC', administrativeArea1: 'Pichincha', city: 'Quito', street1: 'Av. Prueba' },
      internalNote: 'forbidden-internal-note',
      payloadHash: 'forbidden-payload-hash',
      regulatoryIdentity: { passport: 'forbidden-passport' },
    } as ProfessionalReviewProjectionManifest;
  }

  it('summary y detail incluyen solo el contrato mínimo allowlisted', () => {
    const summary = toSafeProfessionalApplicationReviewSummary(projection());
    const detail = toSafeProfessionalApplicationReviewDetail(projection());
    expect(summary).toMatchObject({
      applicationId: APPLICATION_ID,
      snapshotRevision: 7,
      legalName: { givenNames: 'Ana', familyNames: 'Pérez' },
    });
    expect(detail).toMatchObject({
      credentials: [{
        title: 'Médico',
        institution: 'Universidad de prueba',
        documents: [{ reviewable: true, blocked: false, pageCount: 2 }],
      }],
      location: { countryCode: 'EC', city: 'Quito' },
    });
  });

  it('nunca filtra claves ni valores sensibles, incluyendo internalNote', () => {
    const serialized = JSON.stringify({
      summary: toSafeProfessionalApplicationReviewSummary(projection()),
      detail: toSafeProfessionalApplicationReviewDetail(projection()),
    });
    expect(serialized).not.toMatch(/publicId|cloudinary|signedUrl|storageProvider|checksum|payloadHash|registrationNumber|passport|regulatoryIdentity|scanStatus|internalNote|forbidden/i);
  });

  it.each(['PENDING', 'REJECTED', 'ERROR'] as const)('reduce %s a blocked sin revelar el estado detallado', (scanStatus) => {
    const manifest = projection();
    manifest.credentials[0]!.documents[0]!.scanStatus = scanStatus;
    const serialized = JSON.stringify(toSafeProfessionalApplicationReviewDetail(manifest));
    const safeDocument = JSON.parse(serialized).credentials[0].documents[0];
    expect(safeDocument).toMatchObject({ reviewable: false, blocked: true });
    expect(JSON.stringify(safeDocument)).not.toContain(scanStatus);
    expect(JSON.stringify(safeDocument)).not.toContain('scanStatus');
  });
});
