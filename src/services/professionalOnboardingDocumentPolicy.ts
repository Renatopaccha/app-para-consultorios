export const ONBOARDING_CREDENTIAL_DOCUMENT_MIME_TYPES = [
  'application/pdf',
  'image/jpeg',
  'image/png',
  'image/webp',
] as const;

export const ONBOARDING_CREDENTIAL_DOCUMENT_FORMATS = ['pdf', 'jpg', 'png', 'webp'] as const;

type AllowedMimeType = (typeof ONBOARDING_CREDENTIAL_DOCUMENT_MIME_TYPES)[number];
type AllowedFormat = (typeof ONBOARDING_CREDENTIAL_DOCUMENT_FORMATS)[number];

const DOCUMENT_STORAGE_COMBINATIONS: ReadonlyArray<{
  mimeType: AllowedMimeType;
  format: AllowedFormat;
  resourceType: 'raw' | 'image';
}> = [
  { mimeType: 'application/pdf', format: 'pdf', resourceType: 'raw' },
  { mimeType: 'image/jpeg', format: 'jpg', resourceType: 'image' },
  { mimeType: 'image/png', format: 'png', resourceType: 'image' },
  { mimeType: 'image/webp', format: 'webp', resourceType: 'image' },
];

export function onboardingCredentialDocumentFolder(applicationId: string, credentialId: string): string {
  return `zenda/professional-onboarding/applications/${applicationId}/credentials/${credentialId}`;
}

export function isPrivateOnboardingCredentialDocument(input: {
  credentialId: string;
  storageProvider: string;
  publicId: string;
  resourceType: string;
  format: string;
  mimeType: string;
}): boolean {
  const privateNamespace = new RegExp(
    `^zenda/professional-onboarding/applications/[^/]+/credentials/${escapeRegExp(input.credentialId)}/document-[^/]+$`,
  );
  return input.storageProvider === 'cloudinary'
    && privateNamespace.test(input.publicId)
    && DOCUMENT_STORAGE_COMBINATIONS.some((allowed) => (
      allowed.mimeType === input.mimeType
      && allowed.format === input.format
      && allowed.resourceType === input.resourceType
    ));
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
