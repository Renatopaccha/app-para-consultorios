import express, { Application, Request, Response } from 'express';
import cors from 'cors';
import dotenv from 'dotenv';

import authRoutes from './routes/auth.routes';
import userRoutes from './routes/user.routes';
import clinicRoutes from './routes/clinic.routes';
import doctorRoutes from './routes/doctor.routes';
import reviewRoutes from './routes/review.routes';
import appointmentRoutes from './routes/appointment.routes';
import patientRoutes from './routes/patient.routes';

// Cargar variables de entorno
dotenv.config();

const app: Application = express();

// Middlewares globales
app.use(cors());
app.use(express.json());

// Rutas de prueba
app.get('/', (req: Request, res: Response) => {
  res.send('API de Vitali funcionando');
});

// Rutas de la API
app.use('/api/auth', authRoutes);
app.use('/api/users', userRoutes);
app.use('/api/clinics', clinicRoutes);
app.use('/api/doctors', doctorRoutes);
app.use('/api/reviews', reviewRoutes);
app.use('/api/appointments', appointmentRoutes);
app.use('/api/patients', patientRoutes);

export default app;
