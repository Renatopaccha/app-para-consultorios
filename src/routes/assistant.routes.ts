import { Router } from 'express';
import { 
  getAssistantDashboard, 
  startConsultation, 
  completeConsultation, 
  markAsMissed, 
  postponeTurn 
} from '../controllers/assistant.controller';
import { authenticate, requireRole } from '../middlewares/auth.middleware';

const router = Router();

// Rutas de Asistente
router.get('/dashboard', authenticate, requireRole(['ASSISTANT']), getAssistantDashboard);

// Smart Queue 4-State Flow
router.patch('/:id/start', authenticate, requireRole(['DOCTOR', 'ASSISTANT']), startConsultation);
router.patch('/:id/complete', authenticate, requireRole(['DOCTOR', 'ASSISTANT']), completeConsultation);
router.patch('/:id/missed', authenticate, requireRole(['DOCTOR', 'ASSISTANT']), markAsMissed);
router.patch('/:id/postpone', authenticate, requireRole(['DOCTOR', 'ASSISTANT']), postponeTurn);

export default router;
