import { Router } from 'express';
import { generateAuthUrl, handleGoogleCallback } from '../controllers/googleAuth.controller';
import { authenticate, requireRole } from '../middlewares/auth.middleware';

const router = Router();

// Ambas rutas deben estar protegidas, solo los doctores pueden sincronizar calendarios
router.get('/auth-url', authenticate, requireRole(['DOCTOR']), generateAuthUrl);
router.post('/callback', authenticate, requireRole(['DOCTOR']), handleGoogleCallback);

export default router;
