import { Router } from 'express';
import { getClinics, getClinicById, createClinic } from '../controllers/clinic.controller';

const router = Router();

router.get('/', getClinics);
router.get('/:id', getClinicById);
router.post('/', createClinic);

export default router;
