import { Router } from 'express';
import { getDoctors, getDoctorById, createDoctor } from '../controllers/doctor.controller';

const router = Router();

router.get('/', getDoctors);
router.get('/:id', getDoctorById);
router.post('/', createDoctor);

export default router;
