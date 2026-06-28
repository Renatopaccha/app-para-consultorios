import { Router } from 'express';
// Importamos la función unificada de registro y el login
import { register, login } from '../controllers/auth.controller';

const router = Router();

// Una sola puerta de entrada inteligente para todos los roles
router.post('/register', register);

// La puerta de inicio de sesión
router.post('/login', login);

export default router;