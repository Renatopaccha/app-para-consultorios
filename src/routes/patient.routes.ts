import { Router } from 'express';
import { getActiveDoctors, scheduleAppointment, getMyAppointments } from '../controllers/patient.controller';
import { authenticate, requireRole } from '../middlewares/auth.middleware';

const router = Router();

// Middleware a nivel de enrutador: 
// TODAS las rutas debajo requieren estar logueados Y tener el rol PATIENT.
router.use(authenticate);
router.use(requireRole(['PATIENT']));

// 1. Buscador de doctores
router.get('/doctors', getActiveDoctors);

// 2. Historial de mis citas
router.get('/my-appointments', getMyAppointments);

// 3. Agendar una cita
router.post('/appointments', scheduleAppointment);

export default router;
