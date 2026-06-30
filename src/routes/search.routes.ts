import { Router } from 'express';
import { searchDoctorsAndClinics } from '../controllers/search.controller';

const router = Router();

// Búsqueda pública de médicos y clínicas
router.get('/doctors', searchDoctorsAndClinics);

export default router;
