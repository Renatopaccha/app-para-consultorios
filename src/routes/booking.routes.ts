import { Router } from 'express';
import { getAvailableSlots, verifyCashPayment, getAppointments, getAppointmentById, updateBookingStatus } from '../controllers/booking.controller';
import { authenticate, requireProfessionalAccessForDoctor, requireRole } from '../middlewares/auth.middleware';
import { bookCanonical, getAvailability, cancelCanonical, rescheduleCanonical, confirmAttendanceLegacy, confirmCanonical } from '../controllers/bookingCanonical.controller';
import { checkIn, start, complete, noShow } from '../controllers/appointmentLifecycle.controller';

const router = Router();

// Obtener horarios disponibles (puede ser pública o protegida según el negocio, aquí protegida)
router.get('/slots', authenticate, getAvailableSlots);
router.get('/availability', getAvailability);
router.post('/book', authenticate, requireRole(['PATIENT']), bookCanonical);
router.post('/verify-payment', authenticate, requireRole(['DOCTOR', 'CLINIC_ADMIN', 'ASSISTANT', 'SUPER_ADMIN']), verifyCashPayment);
router.patch('/:id/cancel', authenticate, requireRole(['PATIENT', 'DOCTOR']), cancelCanonical);
router.patch('/:id/reschedule', authenticate, requireRole(['PATIENT', 'DOCTOR']), rescheduleCanonical);
router.patch('/:id/confirm', authenticate, requireRole(['PATIENT']), confirmCanonical);
router.patch('/:id/check-in', authenticate, requireProfessionalAccessForDoctor, checkIn);
router.patch('/:id/start', authenticate, requireRole(['DOCTOR','CLINIC_ADMIN','ASSISTANT','SUPER_ADMIN']), start);
router.patch('/:id/complete', authenticate, requireRole(['DOCTOR','CLINIC_ADMIN','ASSISTANT','SUPER_ADMIN']), complete);
router.patch('/:id/no-show', authenticate, requireRole(['DOCTOR','CLINIC_ADMIN','ASSISTANT','SUPER_ADMIN']), noShow);
router.patch('/:id/confirm-attendance', authenticate, requireRole(['PATIENT']), confirmAttendanceLegacy);
router.patch('/:id/status', authenticate, requireRole(['DOCTOR', 'CLINIC_ADMIN', 'SUPER_ADMIN']), updateBookingStatus);

// Rutas de lectura de citas (ahora protegidas y unificadas)
router.get('/', authenticate, requireProfessionalAccessForDoctor, getAppointments);
router.get('/:id', authenticate, requireProfessionalAccessForDoctor, getAppointmentById);

export default router;
