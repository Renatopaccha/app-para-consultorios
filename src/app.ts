import express, { Application, Request, Response } from 'express';
import cors from 'cors';
import dotenv from 'dotenv';

import authRoutes from './routes/auth.routes';
import userRoutes from './routes/user.routes';
import clinicRoutes from './routes/clinic.routes';
import doctorRoutes from './routes/doctor.routes';
import reviewRoutes from './routes/review.routes';
import patientRoutes from './routes/patient.routes';
import googleAuthRoutes from './routes/googleAuth.routes';
import searchRoutes from './routes/search.routes';
import bookingRoutes from './routes/booking.routes';
import calendarRoutes from './routes/calendar.routes';
import dashboardRoutes from './routes/dashboard.routes';
import assistantRoutes from './routes/assistant.routes';
import profileRoutes from './routes/profile.routes';

// Tareas programadas (Cron Jobs)
import './jobs/reminder.job';

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
app.use('/api/patients', patientRoutes);
app.use('/api/google', googleAuthRoutes);
app.use('/api/search', searchRoutes);
app.use('/api/bookings', bookingRoutes);
app.use('/api/calendar', calendarRoutes);
app.use('/api/dashboard', dashboardRoutes);
app.use('/api/assistant', assistantRoutes);
app.use('/api/profile', profileRoutes);

export default app;
