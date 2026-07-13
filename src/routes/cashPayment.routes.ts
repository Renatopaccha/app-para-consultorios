import { Router } from 'express';
import { authenticate, requireRole } from '../middlewares/auth.middleware';
import { cashPaymentIpRateLimit, cashPaymentUserRateLimit } from '../middlewares/cashPaymentRateLimit.middleware';
import { confirm, lookup, pending, reissue } from '../controllers/cashPayment.controller';

const router = Router();
const protectedCode = [authenticate, cashPaymentIpRateLimit, cashPaymentUserRateLimit];

router.post('/lookup', ...protectedCode, requireRole(['DOCTOR', 'CLINIC_ADMIN', 'ASSISTANT', 'SUPER_ADMIN']), lookup);
router.get('/pending', authenticate, requireRole(['DOCTOR', 'CLINIC_ADMIN', 'ASSISTANT', 'SUPER_ADMIN']), pending);
router.post('/:paymentId/confirm', ...protectedCode, requireRole(['DOCTOR', 'CLINIC_ADMIN', 'ASSISTANT', 'SUPER_ADMIN']), confirm);
router.post('/:paymentId/reissue-code', ...protectedCode, requireRole(['PATIENT', 'DOCTOR', 'CLINIC_ADMIN', 'ASSISTANT', 'SUPER_ADMIN']), reissue);

export default router;
