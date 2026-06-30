import { Router } from 'express';
import { getDoctors, getDoctorById, createDoctor, getMyAppointments, updateDoctorProfile, addService, addCertification, addWorkSchedule } from '../controllers/doctor.controller';
import { authenticate, requireRole } from '../middlewares/auth.middleware';

const router = Router();

// Rutas protegidas (Dashboard del doctor)
router.get('/my-appointments', authenticate, requireRole(['DOCTOR']), getMyAppointments);
router.put('/profile', authenticate, requireRole(['DOCTOR']), updateDoctorProfile);
router.post('/services', authenticate, requireRole(['DOCTOR']), addService);
router.post('/certifications', authenticate, requireRole(['DOCTOR']), addCertification);
router.post('/schedules', authenticate, requireRole(['DOCTOR']), addWorkSchedule);

router.get('/', getDoctors);
router.post('/', createDoctor);
router.get('/:id', getDoctorById); // Se coloca al final para no interferir con rutas estáticas

export default router;
