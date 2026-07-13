import { Router } from 'express';
import { rateLimit } from 'express-rate-limit';
import { register, login, forgotPassword, resetPassword } from '../controllers/auth.controller';
import { acceptInvitation, validateInvitation } from '../controllers/invitation.controller';

const router = Router();
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  // Keep the middleware active in integration tests while avoiding cross-test
  // throttling from a shared local Supertest address.
  limit: process.env.NODE_ENV === 'test' ? 1000 : 10,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  message: { error: 'Demasiados intentos. Intenta nuevamente más tarde.' },
});

// Rutas principales
router.post('/register', register);
router.post('/login', authLimiter, login);

// Rutas de Recuperación de Contraseña
router.post('/forgot-password', authLimiter, forgotPassword);
router.post('/reset-password', authLimiter, resetPassword);
router.get('/invitations/validate', authLimiter, validateInvitation);
router.post('/accept-invitation', authLimiter, acceptInvitation);

export default router;
