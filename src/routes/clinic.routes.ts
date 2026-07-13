import { Router } from 'express';
import { 
  getClinics, 
  getClinicById, 
  createClinic,
  addDoctorToClinic,
  removeDoctorFromClinic,
  getClinicDoctors,
  getMyClinics
} from '../controllers/clinic.controller';
import { authenticate, requireRole } from '../middlewares/auth.middleware';

const router = Router();

// --- Rutas de Médico Híbrido ---
// Obtener las clínicas del médico autenticado (Debe ir ANTES de /:id para evitar conflicto)
router.get('/my-clinics', authenticate, requireRole(['DOCTOR']), getMyClinics);

// Rutas básicas existentes
router.get('/', getClinics);
router.get('/:id', getClinicById);
router.post('/', authenticate, requireRole(['SUPER_ADMIN']), createClinic);


// Listar doctores de una clínica específica (Pública para que los pacientes puedan ver el directorio)
router.get('/:clinicProfileId/doctors', getClinicDoctors);

// Añadir un doctor a la clínica (Protegido: solo administradores)
router.post(
  '/:clinicProfileId/doctors',
  authenticate,
  requireRole(['CLINIC_ADMIN', 'SUPER_ADMIN']),
  addDoctorToClinic
);

// Dar de baja a un doctor de la clínica (Protegido: solo administradores)
router.delete(
  '/:clinicProfileId/doctors/:doctorProfileId',
  authenticate,
  requireRole(['CLINIC_ADMIN', 'SUPER_ADMIN']),
  removeDoctorFromClinic
);

export default router;
