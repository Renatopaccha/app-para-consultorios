import { Router } from 'express';
import { searchDoctors } from '../controllers/search.controller';

const router = Router();

// Búsqueda pública de médicos
router.get('/doctors', searchDoctors);

export default router;
