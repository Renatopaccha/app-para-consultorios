import crypto from 'crypto';
import type { UploadApiOptions, UploadApiResponse } from 'cloudinary';
import { inspectCertificationDocument } from './certificationDocument.service';
import { ImageValidationError, inspectImage } from './image.service';
import { configuredCloudinary } from '../config/cloudinary';

export const ONBOARDING_IMAGE_MAX_BYTES = 5 * 1024 * 1024;
export const ONBOARDING_DOCUMENT_MAX_BYTES = 8 * 1024 * 1024;
export const ONBOARDING_ACCESS_TTL_SECONDS = 300;

export type StoredOnboardingFile = {
  storageProvider: 'cloudinary';
  publicId: string;
  resourceType: 'image' | 'raw';
  format: 'jpg' | 'png' | 'webp' | 'pdf';
  mimeType: 'image/jpeg' | 'image/png' | 'image/webp' | 'application/pdf';
  sizeBytes: number;
  checksumSha256: string;
  width?: number;
  height?: number;
  pageCount?: number;
};

export class OnboardingStorageError extends Error {
  constructor(public readonly code: string, message: string, public readonly status = 422) { super(message); }
}

type UploadAdapter = (buffer: Buffer, options: UploadApiOptions) => Promise<{ publicId: string; format: string }>;
type DeleteAdapter = (publicId: string, options: UploadApiOptions) => Promise<void>;
type AccessAdapter = (publicId: string, format: string, options: Record<string, unknown>) => string;
let uploadAdapter: UploadAdapter | undefined;
let deleteAdapter: DeleteAdapter | undefined;
let accessAdapter: AccessAdapter | undefined;

export function setOnboardingStorageAdaptersForTests(adapters?: { upload?: UploadAdapter; remove?: DeleteAdapter; access?: AccessAdapter }) {
  uploadAdapter = adapters?.upload;
  deleteAdapter = adapters?.remove;
  accessAdapter = adapters?.access;
}

function upload(buffer: Buffer, options: UploadApiOptions): Promise<UploadApiResponse> {
  return new Promise((resolve, reject) => {
    const stream = configuredCloudinary().uploader.upload_stream(options, (error, result) => {
      if (error) return reject(error);
      if (!result) return reject(new Error('Cloudinary no retornó un resultado válido.'));
      resolve(result);
    });
    stream.end(buffer);
  });
}

function imageFormat(mime: 'image/jpeg' | 'image/png' | 'image/webp'): 'jpg' | 'png' | 'webp' {
  return mime === 'image/jpeg' ? 'jpg' : mime === 'image/png' ? 'png' : 'webp';
}

function sha256(buffer: Buffer): string {
  return crypto.createHash('sha256').update(buffer).digest('hex');
}

function pathFor(applicationId: string, leaf: string): string {
  return `zenda/professional-onboarding/applications/${applicationId}/${leaf}`;
}

export async function uploadOnboardingImage(
  buffer: Buffer,
  declaredMime: string,
  applicationId: string,
  category: 'AVATAR' | 'PRACTICE_INTERIOR' | 'PRACTICE_EXTERIOR',
): Promise<StoredOnboardingFile> {
  if (!buffer.length) throw new OnboardingStorageError('EMPTY_FILE', 'El archivo está vacío.');
  if (buffer.length > ONBOARDING_IMAGE_MAX_BYTES) throw new OnboardingStorageError('UPLOAD_TOO_LARGE', 'La imagen excede el límite de 5 MB.', 413);
  let inspected: ReturnType<typeof inspectImage>;
  try { inspected = inspectImage(buffer); } catch (error) {
    if (error instanceof ImageValidationError) throw new OnboardingStorageError(error.code, error.message);
    throw error;
  }
  if (inspected.mime !== declaredMime) throw new OnboardingStorageError('FILE_CONTENT_TYPE_MISMATCH', 'El contenido no coincide con el tipo MIME declarado.');
  const leaf = category === 'AVATAR' ? 'avatar' : category === 'PRACTICE_INTERIOR' ? 'practice-interior' : 'practice-exterior';
  const options: UploadApiOptions = {
    folder: pathFor(applicationId, leaf),
    public_id: `asset-${crypto.randomUUID()}`,
    resource_type: 'image',
    type: 'authenticated',
    overwrite: false,
  };
  const uploaded = uploadAdapter
    ? await uploadAdapter(buffer, options)
    : await upload(buffer, options).then((result) => ({ publicId: result.public_id, format: result.format || imageFormat(inspected.mime) }));
  return {
    storageProvider: 'cloudinary', publicId: uploaded.publicId, resourceType: 'image',
    format: imageFormat(inspected.mime), mimeType: inspected.mime, sizeBytes: buffer.length,
    checksumSha256: sha256(buffer), width: inspected.width, height: inspected.height,
  };
}

export async function uploadOnboardingCredentialDocument(
  buffer: Buffer,
  declaredMime: string,
  applicationId: string,
  credentialId: string,
): Promise<StoredOnboardingFile> {
  if (buffer.length > ONBOARDING_DOCUMENT_MAX_BYTES) throw new OnboardingStorageError('UPLOAD_TOO_LARGE', 'El documento excede el límite de 8 MB.', 413);
  let inspected: ReturnType<typeof inspectCertificationDocument>;
  try { inspected = inspectCertificationDocument(buffer, declaredMime); } catch (error) {
    const code = error instanceof Error && 'code' in error ? String(error.code) : 'INVALID_DOCUMENT';
    throw new OnboardingStorageError(code, error instanceof Error ? error.message : 'Documento no válido.', code === 'DOCUMENT_TOO_LARGE' ? 413 : 422);
  }
  const options: UploadApiOptions = {
    folder: pathFor(applicationId, `credentials/${credentialId}`),
    public_id: `document-${crypto.randomUUID()}`,
    resource_type: inspected.resourceType,
    type: 'authenticated',
    overwrite: false,
  };
  const uploaded = uploadAdapter
    ? await uploadAdapter(buffer, options)
    : await upload(buffer, options).then((result) => ({ publicId: result.public_id, format: result.format || inspected.format }));
  const pages = inspected.mimeType === 'application/pdf' ? buffer.toString('latin1').match(/\/Type\s*\/Page\b/g)?.length ?? undefined : undefined;
  return {
    storageProvider: 'cloudinary', publicId: uploaded.publicId, resourceType: inspected.resourceType,
    format: inspected.format, mimeType: inspected.mimeType, sizeBytes: buffer.length,
    checksumSha256: sha256(buffer), ...(pages ? { pageCount: pages } : {}),
  };
}

export function temporaryOnboardingFileUrl(file: { publicId: string; format: string; resourceType: string }, now = Date.now()) {
  const expiresAt = Math.floor(now / 1000) + ONBOARDING_ACCESS_TTL_SECONDS;
  const options: UploadApiOptions & { expires_at: number; attachment: boolean } = {
    resource_type: file.resourceType === 'raw' ? 'raw' : 'image', type: 'authenticated', expires_at: expiresAt, attachment: false,
  };
  const url = accessAdapter
    ? accessAdapter(file.publicId, file.format, options)
    : configuredCloudinary().utils.private_download_url(file.publicId, file.format, options);
  return { url, expiresAt: new Date(expiresAt * 1000).toISOString(), expiresInSeconds: ONBOARDING_ACCESS_TTL_SECONDS };
}

export async function deleteOnboardingFile(file: { publicId: string; resourceType: string }): Promise<void> {
  const options: UploadApiOptions = { type: 'authenticated', resource_type: file.resourceType === 'raw' ? 'raw' : 'image', invalidate: true };
  if (deleteAdapter) return deleteAdapter(file.publicId, options);
  await configuredCloudinary().uploader.destroy(file.publicId, options);
}
