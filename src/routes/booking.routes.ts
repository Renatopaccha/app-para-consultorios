import { Router } from 'express';
import { getAvailableSlots, bookAppointment, verifyCashPayment, cancelAppointmentByPatient, confirmPatientAttendance, getAppointments, getAppointmentById, updateBookingStatus } from '../controllers/booking.controller';
import { authenticate, requireRole } from '../middlewares/auth.middleware';
import { bookCanonical, getAvailability } from '../controllers/bookingCanonical.controller';

const router = Router();

// Obtener horarios disponibles (puede ser pública o protegida según el negocio, aquí protegida)
router.get('/slots', authenticate, getAvailableSlots);
router.get('/availability', getAvailability);
router.post('/book', authenticate, requireRole(['PATIENT']), bookCanonical);
router.post('/verify-payment', authenticate, requireRole(['DOCTOR', 'CLINIC_ADMIN', 'ASSISTANT', 'SUPER_ADMIN']), verifyCashPayment);
router.patch('/:id/cancel', authenticate, requireRole(['PATIENT']), cancelAppointmentByPatient);
router.patch('/:id/confirm-attendance', authenticate, requireRole(['PATIENT', 'ASSISTANT']), confirmPatientAttendance);
router.patch('/:id/status', authenticate, requireRole(['DOCTOR', 'CLINIC_ADMIN', 'SUPER_ADMIN']), updateBookingStatus);

// Rutas de lectura de citas (ahora protegidas y unificadas)
router.get('/', authenticate, getAppointments);
router.get('/:id', authenticate, getAppointmentById);

export default router;
