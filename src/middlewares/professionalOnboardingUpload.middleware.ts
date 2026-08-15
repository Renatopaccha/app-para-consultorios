import type { NextFunction, Response } from 'express';
import multer from 'multer';
import { ipKeyGenerator, rateLimit } from 'express-rate-limit';
import type { AuthRequest } from './auth.middleware';
import { ONBOARDING_DOCUMENT_MAX_BYTES } from '../services/professionalOnboardingStorage.service';

export const professionalOnboardingUploadRateLimit = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: process.env.NODE_ENV === 'test' ? 1000 : 40,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req: AuthRequest) => req.user?.id ?? ipKeyGenerator(req.ip ?? 'unknown'),
  message: { code: 'PROFESSIONAL_UPLOAD_RATE_LIMITED', message: 'Demasiados archivos. Intenta nuevamente más tarde.' },
});

export const professionalOnboardingUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: ONBOARDING_DOCUMENT_MAX_BYTES, files: 1, fields: 5 },
}).single('file');

export function handleProfessionalOnboardingUploadError(error: unknown, _req: AuthRequest, res: Response, next: NextFunction) {
  if (!error) return next();
  if (error instanceof multer.MulterError && error.code === 'LIMIT_FILE_SIZE') {
    return res.status(413).json({ code: 'UPLOAD_TOO_LARGE', message: 'El archivo excede el límite permitido.' });
  }
  if (error instanceof multer.MulterError) return res.status(422).json({ code: 'INVALID_UPLOAD', message: 'No se pudo procesar el archivo.' });
  return next(error);
}
