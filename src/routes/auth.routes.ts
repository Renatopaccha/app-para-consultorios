import { Router } from 'express';
import { registerPatient, registerClinic, login } from '../controllers/auth.controller';

const router = Router();

router.post('/register/patient', registerPatient);
router.post('/register/clinic', registerClinic);
router.post('/login', login);

export default router;
