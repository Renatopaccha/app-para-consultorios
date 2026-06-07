import { Router } from 'express';
import { getAppointments, getAppointmentById, createAppointment } from '../controllers/appointment.controller';

const router = Router();

router.get('/', getAppointments);
router.get('/:id', getAppointmentById);
router.post('/', createAppointment);

export default router;
