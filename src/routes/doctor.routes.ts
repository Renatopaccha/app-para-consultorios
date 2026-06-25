import { Router } from 'express';
import { getDoctors, getDoctorById, createDoctor, getMyAppointments } from '../controllers/doctor.controller';
import { authenticate, requireRole } from '../middlewares/auth.middleware';

const router = Router();

// Rutas protegidas (Dashboard del doctor)
router.get('/my-appointments', authenticate, requireRole(['DOCTOR']), getMyAppointments);

router.get('/', getDoctors);
router.post('/', createDoctor);
router.get('/:id', getDoctorById); // Se coloca al final para no interferir con rutas estáticas

export default router;
