import 'dotenv/config'; // <-- ESTA LÍNEA ES LA MAGIA (Carga el .env antes que nada)
import app from './app';
import { startCronJobs } from './jobs/appointment.jobs';
import { getJwtSecret } from './utils/jwt';
import { startNotificationOutboxWorker } from './jobs/notificationOutbox.job';
import { validateNotificationOutboxConfiguration } from './services/notificationOutbox.service';
import { validateClerkConfig } from './config/clerk';

const PORT = process.env.PORT || 3000;

// Fail closed before opening the HTTP port when authentication is misconfigured.
getJwtSecret();
validateNotificationOutboxConfiguration();
const clerkConfig = validateClerkConfig();
console.info(`[server] Clerk backend auth: ${clerkConfig.status === 'CONFIGURED' ? 'enabled' : 'disabled'}`);

// Iniciar tareas programadas (Vigilante)
startCronJobs();
startNotificationOutboxWorker();

app.listen(PORT, () => {
  console.log(`[server]: Server is running at http://localhost:${PORT}`);
});
