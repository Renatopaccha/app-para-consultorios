import { Router } from 'express';
import { authenticate, requireRole } from '../middlewares/auth.middleware';
import { payments, summary } from '../controllers/finance.controller';

const router = Router();
router.get('/summary', authenticate, requireRole(['DOCTOR', 'CLINIC_ADMIN', 'ASSISTANT', 'SUPER_ADMIN']), summary);
router.get('/payments', authenticate, requireRole(['DOCTOR', 'CLINIC_ADMIN', 'ASSISTANT', 'SUPER_ADMIN']), payments);
export default router;
