import 'dotenv/config'; // <-- ESTA LÍNEA ES LA MAGIA (Carga el .env antes que nada)
import app from './app';

const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
  console.log(`[server]: Server is running at http://localhost:${PORT}`);
});