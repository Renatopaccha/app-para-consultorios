import { Router } from 'express';
import { getDoctors, getDoctorById, createDoctor, getMyAppointments, updateDoctorProfile, addService, addCertification, addWorkSchedule, getMySchedules, addAppointment, createGuestPatient, searchPatients } from '../controllers/doctor.controller';
import { authenticate, requireRole } from '../middlewares/auth.middleware';

const router = Router();

// Rutas protegidas (Dashboard del doctor)
router.get('/my-appointments', authenticate, requireRole(['DOCTOR']), getMyAppointments);
router.put('/profile', authenticate, requireRole(['DOCTOR']), updateDoctorProfile);
router.post('/services', authenticate, requireRole(['DOCTOR']), addService);
router.post('/certifications', authenticate, requireRole(['DOCTOR']), addCertification);
router.post('/schedules', authenticate, requireRole(['DOCTOR']), addWorkSchedule);
router.get('/schedules', authenticate, requireRole(['DOCTOR']), getMySchedules);
router.post('/appointments', authenticate, requireRole(['DOCTOR']), addAppointment);


router.get('/', getDoctors);
router.post('/', authenticate, requireRole(['SUPER_ADMIN']), createDoctor);
router.get('/:id', getDoctorById); // Se coloca al final para no interferir con rutas estáticas

// 4. Creación de cuenta fantasma para paciente (Modal)
router.post('/patients/guest', authenticate, requireRole(['DOCTOR']), createGuestPatient);

// 5. Búsqueda de pacientes
router.get('/patients/search', authenticate, requireRole(['DOCTOR']), searchPatients);

export default router;
