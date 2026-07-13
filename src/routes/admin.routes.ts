import { Router } from 'express';
import { rateLimit } from 'express-rate-limit';
import { authenticate, requireRole } from '../middlewares/auth.middleware';
import { createInvitation, listInvitations, resendInvitation, revokeInvitation, updateClinicVerification, updateDoctorVerification } from '../controllers/invitation.controller';

const router = Router();
const invitationLimiter = rateLimit({ windowMs: 15 * 60 * 1000, limit: process.env.NODE_ENV === 'test' ? 1000 : 10, standardHeaders: 'draft-8', legacyHeaders: false, message: { error: 'Demasiados intentos de invitación.' } });

router.use(authenticate);
router.post('/invitations', requireRole(['SUPER_ADMIN', 'CLINIC_ADMIN']), invitationLimiter, createInvitation);
router.get('/invitations', requireRole(['SUPER_ADMIN', 'CLINIC_ADMIN']), listInvitations);
router.post('/invitations/:id/revoke', requireRole(['SUPER_ADMIN', 'CLINIC_ADMIN']), revokeInvitation);
router.post('/invitations/:id/resend', requireRole(['SUPER_ADMIN', 'CLINIC_ADMIN']), invitationLimiter, resendInvitation);
router.patch('/doctors/:id/verification', requireRole(['SUPER_ADMIN']), updateDoctorVerification);
router.patch('/clinics/:id/verification', requireRole(['SUPER_ADMIN']), updateClinicVerification);

export default router;
