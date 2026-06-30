import { Router } from 'express';
import { getGoogleAuthUrl, googleCallback, getOutlookAuthUrl, outlookCallback } from '../controllers/calendar.controller';
import { authenticate, requireRole } from '../middlewares/auth.middleware';

const router = Router();

// Rutas protegidas (Generar URL de autenticación)
router.get('/google/auth', authenticate, requireRole(['DOCTOR', 'CLINIC_ADMIN']), getGoogleAuthUrl);
router.get('/outlook/auth', authenticate, requireRole(['DOCTOR', 'CLINIC_ADMIN']), getOutlookAuthUrl);

// Rutas públicas (Callbacks de los proveedores)
router.get('/google/callback', googleCallback);
router.get('/outlook/callback', outlookCallback);

export default router;
