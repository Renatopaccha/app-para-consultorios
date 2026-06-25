import { Router } from 'express';
// Fíjate que aquí agregué "registerDoctor" a la lista de importaciones
import { registerPatient, registerClinic, registerDoctor, login } from '../controllers/auth.controller';

const router = Router();

router.post('/register-patient', registerPatient);
router.post('/register/clinic', registerClinic);
router.post('/register/doctor', registerDoctor); // <-- Aquí está la nueva ruta
router.post('/login', login);

export default router;