import { Router } from 'express';
import { register, login, forgotPassword, resetPassword } from '../controllers/auth.controller';

const router = Router();

// Rutas principales
router.post('/register', register);
router.post('/login', login);

// Rutas de Recuperación de Contraseña
router.post('/forgot-password', forgotPassword);
router.post('/reset-password', resetPassword);

export default router;