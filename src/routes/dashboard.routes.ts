import { Router } from 'express';
import { getClinicDashboardMetrics, getMetrics } from '../controllers/dashboard.controller';
import { authenticate, requireRole } from '../middlewares/auth.middleware';

const router = Router();

// Rutas de métricas para Clínica (Admin y Asistente)
router.get('/clinic', authenticate, requireRole(['CLINIC_ADMIN', 'ASSISTANT']), getClinicDashboardMetrics);

// Nueva ruta para las métricas del Doctor
router.get('/metrics', authenticate, requireRole(['DOCTOR']), getMetrics);


export default router;
