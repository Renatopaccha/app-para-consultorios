import { Prisma } from '../../generated/prisma';
import type { Response } from 'express';
import type { AuthRequest } from '../middlewares/auth.middleware';
import { ProfessionalOnboardingError } from '../services/professionalOnboarding.service';
import { OnboardingStorageError } from '../services/professionalOnboardingStorage.service';
import {
  accessApplicationAsset,
  accessCredentialDocument,
  createApplicationAsset,
  createCredentialDocument,
  softDeleteApplicationAsset,
  softDeleteCredentialDocument,
  reorderPracticeAssets,
} from '../services/professionalOnboardingUpload.service';

async function respond(res: Response, operation: () => Promise<unknown>, status = 200) {
  try { return res.status(status).json(await operation()); } catch (error) {
    if (error instanceof ProfessionalOnboardingError || error instanceof OnboardingStorageError) {
      return res.status(error.status).json({ code: error.code, message: error.message, ...('details' in error && error.details ? { details: error.details } : {}) });
    }
    if (error instanceof Prisma.PrismaClientKnownRequestError && ['P2002', 'P2034'].includes(error.code)) {
      return res.status(409).json({ code: 'PROFESSIONAL_APPLICATION_CONFLICT', message: 'El archivo entra en conflicto con la revisión actual.' });
    }
    console.error('[ProfessionalOnboardingUpload] Error:', error instanceof Error ? error.message : 'unknown');
    return res.status(500).json({ code: 'PROFESSIONAL_UPLOAD_FAILED', message: 'No se pudo completar la operación de archivo.' });
  }
}

export const uploadAsset = (req: AuthRequest, res: Response) => respond(res, () => createApplicationAsset(req.user!.id, req.body ?? {}, req.file), 201);
export const uploadCredentialDocument = (req: AuthRequest, res: Response) => respond(res, () => createCredentialDocument(req.user!.id, String(req.params.credentialId), req.body ?? {}, req.file), 201);
export const getAssetAccess = (req: AuthRequest, res: Response) => respond(res, () => accessApplicationAsset(req.user!.id, String(req.params.assetId)));
export const getCredentialDocumentAccess = (req: AuthRequest, res: Response) => respond(res, () => accessCredentialDocument(req.user!.id, String(req.params.credentialId), String(req.params.documentId)));
export const deleteAsset = (req: AuthRequest, res: Response) => respond(res, () => softDeleteApplicationAsset(req.user!.id, String(req.params.assetId), req.body?.expectedRevision));
export const deleteCredentialDocument = (req: AuthRequest, res: Response) => respond(res, () => softDeleteCredentialDocument(req.user!.id, String(req.params.credentialId), String(req.params.documentId), req.body?.expectedRevision));
export const reorderAssets = (req: AuthRequest, res: Response) => respond(res, () => reorderPracticeAssets(req.user!.id, req.body ?? {}));
