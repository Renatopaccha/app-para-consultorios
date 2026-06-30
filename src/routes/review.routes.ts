import { Router } from 'express';
import { createReview, getDoctorReviews } from '../controllers/review.controller';
import { authenticate, requireRole } from '../middlewares/auth.middleware';

const router = Router();

// Crear reseña - Solo accesible por pacientes
router.post('/', authenticate, requireRole(['PATIENT']), createReview);

// Ver reseñas de un doctor - Pública para mostrarse en el perfil del médico
router.get('/doctor/:doctorId', getDoctorReviews);

export default router;
