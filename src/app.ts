import 'newrelic';
import express, { Application, ErrorRequestHandler, Request, Response } from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import helmet from 'helmet';

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
import adminRoutes from './routes/admin.routes';
import scheduleBlockRoutes from './routes/scheduleBlock.routes';
import turnRoutes from './routes/turn.routes';
import cashPaymentRoutes from './routes/cashPayment.routes';
import financeRoutes from './routes/finance.routes';
import notificationRoutes from './routes/notification.routes';
import professionalOnboardingRoutes from './routes/professionalOnboarding.routes';
import clerkWebhookRoutes from './routes/clerkWebhook.routes';
import { clerkSessionMiddleware } from './services/clerkSession.service';
import { assertProfessionalAuthConfiguration } from './config/professionalAuthorization';

// Cargar variables de entorno. Tests never load development configuration.
if (process.env.NODE_ENV === 'test') {
  dotenv.config({ path: '.env.test' });
} else {
  dotenv.config();
}
assertProfessionalAuthConfiguration();

const app: Application = express();
const allowedOrigins = (process.env.CORS_ORIGIN || '')
  .split(',')
  .map((origin) => origin.trim())
  .filter(Boolean);

// Middlewares globales
app.use(helmet());
app.use(cors({ origin: allowedOrigins.length > 0 ? allowedOrigins : false }));
// Clerk signs the exact request bytes. Mount this public, signature-protected
// route before express.json() so only this endpoint receives a raw Buffer.
app.use('/api/webhooks/clerk', express.raw({ type: 'application/json', limit: '256kb' }), clerkWebhookRoutes);
app.use(express.json({ limit: '1mb' }));
// Optional while legacy JWT and Clerk coexist. When Clerk is configured, this
// verifies its session before Zenda maps it to the internal UUID.
app.use(clerkSessionMiddleware());

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
app.use('/api/admin', adminRoutes);
app.use('/api/schedule-blocks', scheduleBlockRoutes);
app.use('/api/turns', turnRoutes);
app.use('/api/cash-payments', cashPaymentRoutes);
app.use('/api/finance', financeRoutes);
app.use('/api/notifications', notificationRoutes);
app.use('/api/professional-onboarding', professionalOnboardingRoutes);

const errorHandler: ErrorRequestHandler = (error, _req, res, _next) => {
  console.error('[API] Unhandled request error:', error instanceof Error ? error.message : error);
  if (res.headersSent) return;
  res.status(500).json({ error: 'Error interno del servidor' });
};

app.use(errorHandler);

export default app;
