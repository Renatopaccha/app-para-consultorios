import crypto from 'crypto';
import type { UploadApiOptions, UploadApiResponse } from 'cloudinary';
import { configuredCloudinary } from '../config/cloudinary';

export type SupportedImageMime = 'image/jpeg' | 'image/png' | 'image/webp';
export type InspectedImage = { mime: SupportedImageMime; width: number; height: number };
export type ProfileImageUrls = { original: string; avatar: string; profile: string };

export class ImageValidationError extends Error {
  constructor(public code: 'EMPTY_IMAGE' | 'UNSUPPORTED_IMAGE' | 'INVALID_IMAGE' | 'IMAGE_DIMENSIONS_EXCEEDED', message: string) { super(message); }
}

function jpegDimensions(buffer: Buffer): { width: number; height: number } | null {
  let offset = 2;
  while (offset + 8 < buffer.length) {
    if (buffer[offset] !== 0xff) { offset += 1; continue; }
    const marker = buffer[offset + 1]!;
    if (marker === 0xd8 || marker === 0xd9) { offset += 2; continue; }
    const length = buffer.readUInt16BE(offset + 2);
    if (length < 2 || offset + 2 + length > buffer.length) return null;
    if ([0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf].includes(marker)) {
      return { height: buffer.readUInt16BE(offset + 5), width: buffer.readUInt16BE(offset + 7) };
    }
    offset += 2 + length;
  }
  return null;
}

function webpDimensions(buffer: Buffer): { width: number; height: number } | null {
  const chunk = buffer.toString('ascii', 12, 16);
  if (chunk === 'VP8X' && buffer.length >= 30) return { width: 1 + buffer.readUIntLE(24, 3), height: 1 + buffer.readUIntLE(27, 3) };
  if (chunk === 'VP8L' && buffer.length >= 25 && buffer[20] === 0x2f) {
    const bits = buffer.readUInt32LE(21);
    return { width: (bits & 0x3fff) + 1, height: ((bits >> 14) & 0x3fff) + 1 };
  }
  if (chunk === 'VP8 ' && buffer.length >= 30 && buffer[23] === 0x9d && buffer[24] === 0x01 && buffer[25] === 0x2a) {
    return { width: buffer.readUInt16LE(26) & 0x3fff, height: buffer.readUInt16LE(28) & 0x3fff };
  }
  return null;
}

export function inspectImage(buffer: Buffer): InspectedImage {
  if (!buffer.length) throw new ImageValidationError('EMPTY_IMAGE', 'La imagen está vacía.');
  let mime: SupportedImageMime | null = null;
  let dimensions: { width: number; height: number } | null = null;
  if (buffer.length >= 24 && buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) && buffer.toString('ascii', 12, 16) === 'IHDR') {
    mime = 'image/png'; dimensions = { width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20) };
  } else if (buffer.length >= 4 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) {
    mime = 'image/jpeg'; dimensions = jpegDimensions(buffer);
  } else if (buffer.length >= 30 && buffer.toString('ascii', 0, 4) === 'RIFF' && buffer.toString('ascii', 8, 12) === 'WEBP') {
    mime = 'image/webp'; dimensions = webpDimensions(buffer);
  }
  if (!mime) throw new ImageValidationError('UNSUPPORTED_IMAGE', 'El contenido no es una imagen JPEG, PNG o WebP válida.');
  if (!dimensions || dimensions.width <= 0 || dimensions.height <= 0) throw new ImageValidationError('INVALID_IMAGE', 'No se pudieron validar las dimensiones de la imagen.');
  if (dimensions.width > 8_000 || dimensions.height > 8_000 || dimensions.width * dimensions.height > 32_000_000) {
    throw new ImageValidationError('IMAGE_DIMENSIONS_EXCEEDED', 'La imagen excede las dimensiones permitidas.');
  }
  return { mime, ...dimensions };
}

export function cloudinaryTransformedUrl(url: string, transformation: string): string {
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== 'https:' || parsed.hostname !== 'res.cloudinary.com') return url;
    const marker = '/image/upload/';
    if (!parsed.pathname.includes(marker)) return url;
    parsed.pathname = parsed.pathname.replace(marker, `${marker}${transformation}/`);
    return parsed.toString();
  } catch { return url; }
}

export function profileImageUrls(original: string | null): ProfileImageUrls | null {
  if (!original) return null;
  return {
    original,
    avatar: cloudinaryTransformedUrl(original, 'c_fill,g_auto,w_96,h_96,q_auto,f_auto'),
    profile: cloudinaryTransformedUrl(original, 'c_fill,g_auto,w_600,h_600,q_auto,f_auto'),
  };
}

type ProfileUpload = { secureUrl: string; publicId: string };
type ProfileUploadAdapter = (buffer: Buffer, folder: string) => Promise<ProfileUpload>;
let testProfileUploadAdapter: ProfileUploadAdapter | undefined;
export function setProfileImageUploadAdapterForTests(adapter?: ProfileUploadAdapter) { testProfileUploadAdapter = adapter; }

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

function publicIdFromUrl(url: string | null): string | null {
  if (!url) return null;
  try {
    const parsed = new URL(url); const marker = '/image/upload/'; const index = parsed.pathname.indexOf(marker);
    if (parsed.hostname !== 'res.cloudinary.com' || index < 0) return null;
    const tail = parsed.pathname.slice(index + marker.length).replace(/^v\d+\//, '');
    return decodeURIComponent(tail.replace(/\.[^.]+$/, '')) || null;
  } catch { return null; }
}

export const imageService = {
  uploadImage: async (fileBuffer: Buffer, folder: string, publicId?: string): Promise<string> => {
    const result = await upload(fileBuffer, { folder, format: 'webp', quality: 'auto', ...(publicId ? { public_id: publicId, overwrite: true, invalidate: true } : {}) });
    return result.secure_url;
  },
  uploadProfileImage: async (fileBuffer: Buffer, folder: string): Promise<ProfileUpload> => {
    if (testProfileUploadAdapter) return testProfileUploadAdapter(fileBuffer, folder);
    const result = await upload(fileBuffer, { folder, public_id: `avatar-${crypto.randomUUID()}`, resource_type: 'image', format: 'webp', quality: 'auto', overwrite: false });
    return { secureUrl: result.secure_url, publicId: result.public_id };
  },
  deleteReplacedProfileImage: async (previousUrl: string | null, currentPublicId: string): Promise<void> => {
    const previousPublicId = publicIdFromUrl(previousUrl);
    if (previousPublicId && previousPublicId !== currentPublicId) await configuredCloudinary().uploader.destroy(previousPublicId, { invalidate: true, resource_type: 'image' });
  },
};
