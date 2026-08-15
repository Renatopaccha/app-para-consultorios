import type { Response } from 'express';
import { Prisma } from '../../generated/prisma';
import type { AuthRequest } from '../middlewares/auth.middleware';
import {
  autosaveIdentity,
  autosaveLocation,
  autosaveProfile,
  createCredential,
  deleteCredential,
  getProfessionalOnboardingBootstrap,
  listLanguages,
  listProfessions,
  listSpecialties,
  ProfessionalOnboardingError,
  replaceSpecialties,
  startProfessionalOnboarding,
  submitProfessionalApplication,
  updateCredential,
  updateProgress,
} from '../services/professionalOnboarding.service';

type HandlerOperation = (userId: string) => Promise<unknown>;

async function respond(req: AuthRequest, res: Response, operation: HandlerOperation, successStatus = 200) {
  if (!req.user) return res.status(401).json({ code: 'AUTH_CREDENTIALS_MISSING', message: 'Autenticación requerida.' });
  try {
    const result = await operation(req.user.id);
    return res.status(successStatus).json(result);
  } catch (error) {
    if (error instanceof ProfessionalOnboardingError) {
      return res.status(error.status).json({ code: error.code, message: error.message, ...(error.details ? { details: error.details } : {}) });
    }
    if (error instanceof Prisma.PrismaClientKnownRequestError && ['P2002', 'P2034'].includes(error.code)) {
      return res.status(409).json({ code: 'PROFESSIONAL_APPLICATION_CONFLICT', message: 'La solicitud cambió o entra en conflicto con datos existentes.' });
    }
    console.error('[ProfessionalOnboarding] Error no controlado:', error instanceof Error ? error.message : 'unknown');
    return res.status(500).json({ code: 'PROFESSIONAL_ONBOARDING_UNAVAILABLE', message: 'No se pudo procesar el onboarding profesional.' });
  }
}

export const bootstrap = (req: AuthRequest, res: Response) => respond(req, res, getProfessionalOnboardingBootstrap);
export const start = (req: AuthRequest, res: Response) => respond(req, res, (userId) => startProfessionalOnboarding(userId), 200);
export const saveIdentity = (req: AuthRequest, res: Response) => respond(req, res, (userId) => autosaveIdentity(userId, req.body ?? {}));
export const saveSpecialties = (req: AuthRequest, res: Response) => respond(req, res, (userId) => replaceSpecialties(userId, req.body ?? {}));
export const addCredential = (req: AuthRequest, res: Response) => respond(req, res, (userId) => createCredential(userId, req.body ?? {}), 201);
export const editCredential = (req: AuthRequest, res: Response) => respond(req, res, (userId) => updateCredential(userId, String(req.params.credentialId), req.body ?? {}));
export const removeCredential = (req: AuthRequest, res: Response) => respond(req, res, (userId) => deleteCredential(userId, String(req.params.credentialId), req.body ?? {}));
export const saveLocation = (req: AuthRequest, res: Response) => respond(req, res, (userId) => autosaveLocation(userId, req.body ?? {}));
export const saveProfile = (req: AuthRequest, res: Response) => respond(req, res, (userId) => autosaveProfile(userId, req.body ?? {}));
export const saveProgress = (req: AuthRequest, res: Response) => respond(req, res, (userId) => updateProgress(userId, req.body ?? {}));
export const submit = (req: AuthRequest, res: Response) => respond(req, res, (userId) => submitProfessionalApplication(userId, req.body ?? {}, req.header('Idempotency-Key')));

export const professions = (req: AuthRequest, res: Response) => respond(req, res, async () => ({ items: await listProfessions() }));
export const specialties = (req: AuthRequest, res: Response) => respond(req, res, async () => ({ items: await listSpecialties(String(req.query.healthProfessionId ?? req.query.profession ?? '')) }));
export const languages = (req: AuthRequest, res: Response) => respond(req, res, async () => ({ items: await listLanguages() }));
