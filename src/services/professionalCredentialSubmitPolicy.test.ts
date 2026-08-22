import {
  CREDENTIAL_SUBMIT_POLICY_VERSION,
  evaluateCredentialSubmitPolicy,
  type CredentialSubmitManifest,
} from './professionalCredentialSubmitPolicy';

const APPLICATION_ID = '11111111-1111-4111-8111-111111111111';
const USER_ID = '22222222-2222-4222-8222-222222222222';
const PRIMARY_ID = '33333333-3333-4333-8333-333333333333';

function document(
  credentialId = PRIMARY_ID,
  overrides: Partial<CredentialSubmitManifest['credentials'][number]['documents'][number]> = {},
) {
  return {
    credentialId,
    storageProvider: 'cloudinary',
    publicId: `zenda/professional-onboarding/applications/${APPLICATION_ID}/credentials/${credentialId}/document-test`,
    resourceType: 'raw',
    format: 'pdf',
    mimeType: 'application/pdf',
    scanStatus: 'PENDING' as const,
    deletedAt: null,
    ...overrides,
  };
}

function credential(
  overrides: Partial<CredentialSubmitManifest['credentials'][number]> = {},
): CredentialSubmitManifest['credentials'][number] {
  return {
    applicationId: APPLICATION_ID,
    credentialId: PRIMARY_ID,
    credentialUserId: USER_ID,
    credentialType: 'PRIMARY_DEGREE',
    isPrimary: true,
    deletedAt: null,
    documents: [document()],
    ...overrides,
  };
}

function manifest(overrides: Partial<CredentialSubmitManifest> = {}): CredentialSubmitManifest {
  return {
    applicationId: APPLICATION_ID,
    userId: USER_ID,
    declaredSpecialtyCount: 0,
    credentials: [credential()],
    ...overrides,
  };
}

describe(CREDENTIAL_SUBMIT_POLICY_VERSION, () => {
  it('acepta una PRIMARY_DEGREE principal con documento privado PENDING', () => {
    expect(evaluateCredentialSubmitPolicy(manifest())).toEqual([]);
  });

  it('rechaza ausencia, duplicidad y tipo incorrecto de credencial principal', () => {
    expect(evaluateCredentialSubmitPolicy(manifest({ credentials: [] }))).toEqual([
      expect.objectContaining({ code: 'PRIMARY_CREDENTIAL_REQUIRED', target: { type: 'APPLICATION', id: APPLICATION_ID } }),
    ]);

    const secondId = '44444444-4444-4444-8444-444444444444';
    expect(evaluateCredentialSubmitPolicy(manifest({ credentials: [
      credential(),
      credential({ credentialId: secondId, documents: [document(secondId)] }),
    ] }))).toEqual([
      expect.objectContaining({ code: 'MULTIPLE_PRIMARY_CREDENTIALS' }),
    ]);

    expect(evaluateCredentialSubmitPolicy(manifest({ credentials: [credential({ credentialType: 'SPECIALTY' })] }))).toEqual([
      expect.objectContaining({ code: 'PRIMARY_CREDENTIAL_REQUIRED' }),
    ]);
  });

  it.each(['REJECTED', 'ERROR'] as const)('no considera %s como evidencia elegible', (scanStatus) => {
    const violations = evaluateCredentialSubmitPolicy(manifest({
      credentials: [credential({ documents: [document(PRIMARY_ID, { scanStatus })] })],
    }));
    expect(violations).toEqual([
      expect.objectContaining({ code: 'PRIMARY_CREDENTIAL_DOCUMENT_REQUIRED', target: { type: 'CREDENTIAL', id: PRIMARY_ID } }),
    ]);
  });

  it('ignora documentos soft-deleted y metadata que no pertenece al flujo privado permitido', () => {
    const invalidDocuments = [
      document(PRIMARY_ID, { deletedAt: new Date() }),
      document(PRIMARY_ID, { publicId: 'otro-flujo/documento' }),
      document(PRIMARY_ID, { mimeType: 'image/svg+xml', format: 'svg', resourceType: 'image' }),
      document('55555555-5555-4555-8555-555555555555'),
    ];
    expect(evaluateCredentialSubmitPolicy(manifest({
      credentials: [credential({ documents: invalidDocuments })],
    }))).toEqual([expect.objectContaining({ code: 'PRIMARY_CREDENTIAL_DOCUMENT_REQUIRED' })]);
  });

  it('aplica la regla agregada de especialidad sin afirmar un vínculo individual', () => {
    const missing = evaluateCredentialSubmitPolicy(manifest({ declaredSpecialtyCount: 1 }));
    expect(missing).toContainEqual(expect.objectContaining({ code: 'SPECIALTY_CREDENTIAL_REQUIRED' }));

    const specialtyId = '66666666-6666-4666-8666-666666666666';
    const withoutDocument = evaluateCredentialSubmitPolicy(manifest({
      declaredSpecialtyCount: 1,
      credentials: [credential(), credential({
        credentialId: specialtyId,
        credentialType: 'SPECIALTY',
        isPrimary: false,
        documents: [],
      })],
    }));
    expect(withoutDocument).toContainEqual(expect.objectContaining({ code: 'SPECIALTY_CREDENTIAL_DOCUMENT_REQUIRED' }));

    expect(evaluateCredentialSubmitPolicy(manifest({
      declaredSpecialtyCount: 1,
      credentials: [credential(), credential({
        credentialId: specialtyId,
        credentialType: 'SPECIALTY',
        isPrimary: false,
        documents: [document(specialtyId)],
      })],
    }))).toEqual([]);
  });

  it('no cuenta relaciones corruptas cross-user o cross-application', () => {
    expect(evaluateCredentialSubmitPolicy(manifest({
      credentials: [credential({ credentialUserId: '77777777-7777-4777-8777-777777777777' })],
    }))).toContainEqual(expect.objectContaining({ code: 'PRIMARY_CREDENTIAL_REQUIRED' }));
    expect(evaluateCredentialSubmitPolicy(manifest({
      credentials: [credential({ applicationId: '88888888-8888-4888-8888-888888888888' })],
    }))).toContainEqual(expect.objectContaining({ code: 'PRIMARY_CREDENTIAL_REQUIRED' }));
  });

  it('devuelve solo el contrato seguro permitido para UI', () => {
    const serialized = JSON.stringify(evaluateCredentialSubmitPolicy(manifest({
      credentials: [credential({ documents: [] })],
    })));
    expect(serialized).not.toMatch(/publicId|cloudinary|checksum|scanStatus|registration|identity|REJECTED|ERROR/i);
  });
});
