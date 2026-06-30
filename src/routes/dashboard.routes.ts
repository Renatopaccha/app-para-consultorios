import { Router } from 'express';
import { getClinicDashboardMetrics } from '../controllers/dashboard.controller';
import { authenticate, requireRole } from '../middlewares/auth.middleware';

const router = Router();

// Rutas de métricas para Clínica (Admin y Asistente)
router.get('/clinic', authenticate, requireRole(['CLINIC_ADMIN', 'ASSISTANT']), getClinicDashboardMetrics);

export default router;
