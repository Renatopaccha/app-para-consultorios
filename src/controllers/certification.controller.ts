import type { NextFunction, Response } from 'express';
import multer from 'multer';
import type { AuthRequest } from '../middlewares/auth.middleware';
import { CERTIFICATION_MAX_BYTES, CertificationDocumentError } from '../services/certificationDocument.service';
import { CertificationError, createCertification, certificationDocumentForReviewer, listCertificationsForReview, listMyCertifications, reviewCertification, softDeleteCertification, submitCertification, updateCertification } from '../services/certification.service';

export const certificationUpload = multer({ storage: multer.memoryStorage(), limits: { fileSize: CERTIFICATION_MAX_BYTES, files: 1 } }).single('document');

export function handleCertificationUploadError(error: unknown, _req: AuthRequest, res: Response, next: NextFunction) {
  if (!error) return next();
  if (error instanceof multer.MulterError && error.code === 'LIMIT_FILE_SIZE') return res.status(413).json({ error: 'DOCUMENT_TOO_LARGE', message: 'El documento excede el límite de 8 MB.' });
  if (error instanceof multer.MulterError) return res.status(422).json({ error: 'INVALID_DOCUMENT_UPLOAD', message: 'No se pudo procesar el documento.' });
  return next(error);
}

function respondError(res: Response, error: unknown) {
  if (error instanceof CertificationError) return res.status(error.status).json({ error: error.code, message: error.message });
  if (error instanceof CertificationDocumentError) return res.status(error.code === 'DOCUMENT_TOO_LARGE' ? 413 : 422).json({ error: error.code, message: error.message });
  console.error('[Certification] Error:', error instanceof Error ? error.message : error);
  return res.status(500).json({ error: 'CERTIFICATION_OPERATION_FAILED', message: 'No se pudo completar la operación.' });
}

export async function getMyCertifications(req: AuthRequest, res: Response) {
  try { return res.json(await listMyCertifications(req.user!.id)); } catch (error) { return respondError(res, error); }
}
export async function postMyCertification(req: AuthRequest, res: Response) {
  try { return res.status(201).json(await createCertification(req.user!.id, req.body, req.file)); } catch (error) { return respondError(res, error); }
}
export async function patchMyCertification(req: AuthRequest, res: Response) {
  try { return res.json(await updateCertification(req.user!.id, String(req.params.id), req.body, req.file)); } catch (error) { return respondError(res, error); }
}
export async function postSubmitCertification(req: AuthRequest, res: Response) {
  try { return res.json(await submitCertification(req.user!.id, String(req.params.id))); } catch (error) { return respondError(res, error); }
}
export async function deleteMyCertification(req: AuthRequest, res: Response) {
  try { await softDeleteCertification(req.user!.id, String(req.params.id)); return res.status(204).send(); } catch (error) { return respondError(res, error); }
}
export async function getAdminCertifications(req: AuthRequest, res: Response) {
  try { return res.json(await listCertificationsForReview(req.user!.id, req.user!.role, typeof req.query.status === 'string' ? req.query.status : undefined)); } catch (error) { return respondError(res, error); }
}
export async function patchAdminCertificationReview(req: AuthRequest, res: Response) {
  try { return res.json(await reviewCertification(req.user!.id, req.user!.role, String(req.params.id), req.body?.action, req.body?.reason)); } catch (error) { return respondError(res, error); }
}
export async function getAdminCertificationDocument(req: AuthRequest, res: Response) {
  try { return res.json(await certificationDocumentForReviewer(req.user!.id, req.user!.role, String(req.params.id))); } catch (error) { return respondError(res, error); }
}
