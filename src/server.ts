import 'dotenv/config'; // <-- ESTA LÍNEA ES LA MAGIA (Carga el .env antes que nada)
import app from './app';
import { startCronJobs } from './jobs/appointment.jobs';
import { getJwtSecret } from './utils/jwt';

const PORT = process.env.PORT || 3000;

// Fail closed before opening the HTTP port when authentication is misconfigured.
getJwtSecret();

// Iniciar tareas programadas (Vigilante)
startCronJobs();

app.listen(PORT, () => {
  console.log(`[server]: Server is running at http://localhost:${PORT}`);
});
