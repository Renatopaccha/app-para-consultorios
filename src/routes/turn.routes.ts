import { Router } from 'express';
import { authenticate, requireRole } from '../middlewares/auth.middleware';
import { call, completeTurn, delay, today } from '../controllers/appointmentLifecycle.controller';
const router = Router(); router.use(authenticate); router.get('/today', today); router.patch('/:id/call', requireRole(['DOCTOR','CLINIC_ADMIN','ASSISTANT','SUPER_ADMIN']), call); router.patch('/:id/delay', requireRole(['DOCTOR','CLINIC_ADMIN','ASSISTANT','SUPER_ADMIN']), delay); router.patch('/:id/complete', requireRole(['DOCTOR','CLINIC_ADMIN','ASSISTANT','SUPER_ADMIN']), completeTurn); export default router;
