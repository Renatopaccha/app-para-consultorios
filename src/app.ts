import express, { Application, Request, Response } from 'express';
import cors from 'cors';
import dotenv from 'dotenv';

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

// Aquí irán las rutas específicas usando app.use(...) en el futuro

export default app;
