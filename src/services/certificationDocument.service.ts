import crypto from 'crypto';
import type { UploadApiOptions, UploadApiResponse } from 'cloudinary';
import { ImageValidationError, inspectImage } from './image.service';
import { configuredCloudinary } from '../config/cloudinary';

export const CERTIFICATION_MAX_BYTES = 8 * 1024 * 1024;
const MAX_PDF_PAGES = 50;

export type CertificationDocument = {
  privateUrl: string;
  publicId: string;
  mimeType: 'application/pdf' | 'image/jpeg' | 'image/png' | 'image/webp';
  sizeBytes: number;
  format: 'pdf' | 'jpg' | 'png' | 'webp';
  resourceType: 'raw' | 'image';
};

export class CertificationDocumentError extends Error {
  constructor(public readonly code: string, message: string) { super(message); }
}

type UploadAdapter = (buffer: Buffer, options: UploadApiOptions) => Promise<{ secureUrl: string; publicId: string; format: string }>;
let testUploadAdapter: UploadAdapter | undefined;
export function setCertificationUploadAdapterForTests(adapter?: UploadAdapter) { testUploadAdapter = adapter; }

function cloudinaryUpload(buffer: Buffer, options: UploadApiOptions): Promise<UploadApiResponse> {
  return new Promise((resolve, reject) => {
    const stream = configuredCloudinary().uploader.upload_stream(options, (error, result) => {
      if (error) return reject(error);
      if (!result) return reject(new Error('Cloudinary no retornó un resultado válido.'));
      resolve(result);
    });
    stream.end(buffer);
  });
}

function inspectPdf(buffer: Buffer) {
  if (!buffer.subarray(0, 8).toString('ascii').match(/^%PDF-1\.[0-7]/)) throw new CertificationDocumentError('INVALID_DOCUMENT', 'El contenido no es un PDF válido.');
  if (!buffer.subarray(Math.max(0, buffer.length - 2048)).toString('latin1').includes('%%EOF')) throw new CertificationDocumentError('INVALID_DOCUMENT', 'El PDF está incompleto.');
  const pages = buffer.toString('latin1').match(/\/Type\s*\/Page\b/g)?.length ?? 0;
  if (pages < 1) throw new CertificationDocumentError('INVALID_DOCUMENT', 'No se pudo validar ninguna página del PDF.');
  if (pages > MAX_PDF_PAGES) throw new CertificationDocumentError('DOCUMENT_PAGE_LIMIT', `El PDF no puede exceder ${MAX_PDF_PAGES} páginas.`);
}

export function inspectCertificationDocument(buffer: Buffer, declaredMime: string) {
  if (!buffer.length) throw new CertificationDocumentError('EMPTY_DOCUMENT', 'El documento está vacío.');
  if (buffer.length > CERTIFICATION_MAX_BYTES) throw new CertificationDocumentError('DOCUMENT_TOO_LARGE', 'El documento excede el límite de 8 MB.');
  if (declaredMime === 'application/pdf') {
    inspectPdf(buffer);
    return { mimeType: 'application/pdf' as const, format: 'pdf' as const, resourceType: 'raw' as const };
  }
  try {
    const image = inspectImage(buffer);
    if (image.mime !== declaredMime) throw new CertificationDocumentError('DOCUMENT_CONTENT_TYPE_MISMATCH', 'El contenido no coincide con el tipo MIME declarado.');
    const format: 'jpg' | 'png' | 'webp' = image.mime === 'image/jpeg' ? 'jpg' : image.mime === 'image/png' ? 'png' : 'webp';
    return { mimeType: image.mime, format, resourceType: 'image' as const };
  } catch (error) {
    if (error instanceof CertificationDocumentError) throw error;
    if (error instanceof ImageValidationError) throw new CertificationDocumentError(error.code, error.message);
    throw error;
  }
}

export async function uploadCertificationDocument(buffer: Buffer, declaredMime: string, doctorProfileId: string): Promise<CertificationDocument> {
  const inspected = inspectCertificationDocument(buffer, declaredMime);
  const options: UploadApiOptions = {
    folder: `zenda/doctors/${doctorProfileId}/certifications`,
    public_id: `document-${crypto.randomUUID()}`,
    resource_type: inspected.resourceType,
    type: 'authenticated',
    overwrite: false,
  };
  const uploaded = testUploadAdapter
    ? await testUploadAdapter(buffer, options)
    : await cloudinaryUpload(buffer, options).then((result) => ({ secureUrl: result.secure_url, publicId: result.public_id, format: result.format || inspected.format }));
  return { privateUrl: uploaded.secureUrl, publicId: uploaded.publicId, mimeType: inspected.mimeType, sizeBytes: buffer.length, format: inspected.format, resourceType: inspected.resourceType };
}

export function temporaryCertificationDocumentUrl(publicId: string, format: string, mimeType: string): string {
  return configuredCloudinary().utils.private_download_url(publicId, format, {
    resource_type: mimeType === 'application/pdf' ? 'raw' : 'image',
    type: 'authenticated',
    expires_at: Math.floor(Date.now() / 1000) + 300,
    attachment: true,
  });
}

export async function deleteCertificationDocument(publicId: string, mimeType: string): Promise<void> {
  if (testUploadAdapter) return;
  await configuredCloudinary().uploader.destroy(publicId, { type: 'authenticated', resource_type: mimeType === 'application/pdf' ? 'raw' : 'image', invalidate: true });
}
