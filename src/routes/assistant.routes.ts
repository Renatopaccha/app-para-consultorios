import { Router } from 'express';
import { getAssistantDashboard, callNextTurn } from '../controllers/assistant.controller';
import { authenticate, requireRole } from '../middlewares/auth.middleware';

const router = Router();

// Rutas de Asistente
router.get('/dashboard', authenticate, requireRole(['ASSISTANT']), getAssistantDashboard);
router.patch('/next-turn', authenticate, requireRole(['DOCTOR', 'ASSISTANT']), callNextTurn);

export default router;
