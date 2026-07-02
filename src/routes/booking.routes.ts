import { Router } from 'express';
import { getAvailableSlots, bookAppointment, verifyCashPayment, cancelAppointmentByPatient, confirmPatientAttendance, getAppointments, getAppointmentById, updateBookingStatus } from '../controllers/booking.controller';
import { authenticate, requireRole } from '../middlewares/auth.middleware';

const router = Router();

// Obtener horarios disponibles (puede ser pública o protegida según el negocio, aquí protegida)
router.get('/slots', authenticate, getAvailableSlots);
router.post('/book', authenticate, requireRole(['PATIENT', 'DOCTOR']), bookAppointment);
router.post('/verify-payment', authenticate, requireRole(['DOCTOR', 'CLINIC_ADMIN']), verifyCashPayment);
router.patch('/:id/cancel', authenticate, requireRole(['PATIENT']), cancelAppointmentByPatient);
router.patch('/:id/confirm-attendance', authenticate, requireRole(['PATIENT']), confirmPatientAttendance);
router.patch('/:id/status', authenticate, requireRole(['DOCTOR', 'CLINIC_ADMIN', 'SUPER_ADMIN']), updateBookingStatus);

// Rutas de lectura de citas (ahora protegidas y unificadas)
router.get('/', authenticate, getAppointments);
router.get('/:id', authenticate, getAppointmentById);

export default router;
