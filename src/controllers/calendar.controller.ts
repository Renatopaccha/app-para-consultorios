import { Request, Response } from 'express';
import { google } from 'googleapis';
import prisma from '../prisma';
import { AuthRequest } from '../middlewares/auth.middleware';

const oauth2Client = new google.auth.OAuth2(
  process.env.GOOGLE_CLIENT_ID,
  process.env.GOOGLE_CLIENT_SECRET,
  'http://localhost:3000/api/calendar/google/callback'
);

// Define los scopes necesarios para leer y escribir eventos en Calendar
const SCOPES = [
  'https://www.googleapis.com/auth/calendar.events',
  'https://www.googleapis.com/auth/calendar.readonly'
];

/**
 * Endpoint protegido para obtener la URL de Google OAuth2.
 * Pasamos de forma segura el userId y role por el parámetro 'state'.
 */
export const getGoogleAuthUrl = (req: AuthRequest, res: Response) => {
  try {
    const userId = req.user?.id;
    const role = req.user?.role;

    if (!userId || !role) {
      return res.status(401).json({ error: 'No autorizado' });
    }

    if (role !== 'DOCTOR' && role !== 'CLINIC_ADMIN') {
      return res.status(403).json({ error: 'Tu rol no tiene permitido sincronizar calendarios' });
    }

    // Codificamos el estado en base64 para que sobreviva al viaje de redirección de Google
    const statePayload = Buffer.from(JSON.stringify({ userId, role })).toString('base64');

    const authUrl = oauth2Client.generateAuthUrl({
      access_type: 'offline', // Fundamental para recibir el refresh_token
      prompt: 'consent',      // Obliga a que pregunte, así nos asegura el refresh_token
      scope: SCOPES,
      state: statePayload
    });

    res.status(200).json({ url: authUrl });
  } catch (error) {
    console.error('[Calendar Controller] Error en getGoogleAuthUrl:', error);
    res.status(500).json({ error: 'Error al generar la URL de autenticación' });
  }
};

/**
 * Endpoint público a donde Google envía el "code" una vez el usuario acepta.
 */
export const googleCallback = async (req: Request, res: Response) => {
  try {
    const { code, state, error: googleError } = req.query;

    if (googleError) {
      return res.status(400).json({ error: `Error de Google: ${googleError}` });
    }

    if (!code || !state || typeof code !== 'string' || typeof state !== 'string') {
      return res.status(400).json({ error: 'Faltan parámetros requeridos de Google' });
    }

    // Decodificar el estado
    let stateData: { userId: string; role: string };
    try {
      const decoded = Buffer.from(state, 'base64').toString('ascii');
      stateData = JSON.parse(decoded);
    } catch (e) {
      return res.status(400).json({ error: 'El estado es inválido o está corrupto' });
    }

    const { userId, role } = stateData;

    // Cambiar código por tokens de acceso
    const { tokens } = await oauth2Client.getToken(code);
    const expiryDate = tokens.expiry_date ? new Date(tokens.expiry_date) : null;

    if (role === 'DOCTOR') {
      const doctor = await prisma.doctorProfile.findUnique({ where: { userId } });
      if (!doctor) return res.status(404).json({ error: 'Perfil de médico no encontrado' });

      await prisma.doctorProfile.update({
        where: { id: doctor.id },
        data: {
          googleAccessToken: tokens.access_token,
          // Si google nos manda un refresh_token, lo actualizamos. Si no, mantenemos el viejo (por defecto prisma ignora undefined en update si usamos destructuring o no lo enviamos)
          ...(tokens.refresh_token && { googleRefreshToken: tokens.refresh_token }),
          googleTokenExpiry: expiryDate
        }
      });
    } else if (role === 'CLINIC_ADMIN') {
      const clinic = await prisma.clinicProfile.findUnique({ where: { userId } });
      if (!clinic) return res.status(404).json({ error: 'Perfil de clínica no encontrado' });

      await prisma.clinicProfile.update({
        where: { id: clinic.id },
        data: {
          googleAccessToken: tokens.access_token,
          ...(tokens.refresh_token && { googleRefreshToken: tokens.refresh_token }),
          googleTokenExpiry: expiryDate
        }
      });
    } else {
      return res.status(403).json({ error: 'Rol no soportado para sincronización' });
    }

    // En un escenario real, harías un res.redirect a tu app Frontend (ej: http://localhost:5173/dashboard?synced=true)
    res.status(200).json({ message: 'Calendario sincronizado exitosamente. Ya puedes cerrar esta ventana.' });
  } catch (error) {
    console.error('[Calendar Controller] Error en googleCallback:', error);
    res.status(500).json({ error: 'Error al procesar la respuesta de Google' });
  }
};

// -------------------------------------------------------------------------
// MICROSOFT OUTLOOK CALENDAR OAUTH2
// -------------------------------------------------------------------------

const OUTLOOK_REDIRECT_URI = 'http://localhost:3000/api/calendar/outlook/callback';

export const getOutlookAuthUrl = (req: AuthRequest, res: Response) => {
  try {
    const userId = req.user?.id;
    const role = req.user?.role;

    if (!userId || !role) {
      return res.status(401).json({ error: 'No autorizado' });
    }

    if (role !== 'DOCTOR' && role !== 'CLINIC_ADMIN') {
      return res.status(403).json({ error: 'Tu rol no tiene permitido sincronizar calendarios' });
    }

    const statePayload = Buffer.from(JSON.stringify({ userId, role })).toString('base64');
    
    // Scopes requeridos para Outlook
    const scopes = 'offline_access https://graph.microsoft.com/Calendars.ReadWrite https://graph.microsoft.com/Calendars.ReadWrite.Shared';

    // Para Microsoft se recomienda usar URLSearchParams para armar la URL
    const params = new URLSearchParams({
      client_id: process.env.OUTLOOK_CLIENT_ID || process.env.AZURE_CLIENT_ID || '',
      response_type: 'code',
      redirect_uri: OUTLOOK_REDIRECT_URI,
      response_mode: 'query',
      scope: scopes,
      state: statePayload
    });

    const authUrl = `https://login.microsoftonline.com/common/oauth2/v2.0/authorize?${params.toString()}`;

    res.status(200).json({ url: authUrl });
  } catch (error) {
    console.error('[Calendar Controller] Error en getOutlookAuthUrl:', error);
    res.status(500).json({ error: 'Error al generar la URL de autenticación de Outlook' });
  }
};

export const outlookCallback = async (req: Request, res: Response) => {
  try {
    const { code, state, error: outlookError } = req.query;

    if (outlookError) {
      return res.status(400).json({ error: `Error de Microsoft: ${outlookError}` });
    }

    if (!code || !state || typeof code !== 'string' || typeof state !== 'string') {
      return res.status(400).json({ error: 'Faltan parámetros requeridos de Microsoft' });
    }

    let stateData: { userId: string; role: string };
    try {
      const decoded = Buffer.from(state, 'base64').toString('ascii');
      stateData = JSON.parse(decoded);
    } catch (e) {
      return res.status(400).json({ error: 'El estado es inválido o está corrupto' });
    }

    const { userId, role } = stateData;

    // Pedir tokens a Microsoft usando client credentials
    const tokenParams = new URLSearchParams({
      client_id: process.env.OUTLOOK_CLIENT_ID || process.env.AZURE_CLIENT_ID || '',
      client_secret: process.env.OUTLOOK_CLIENT_SECRET || '',
      code,
      redirect_uri: OUTLOOK_REDIRECT_URI,
      grant_type: 'authorization_code'
    });

    const tokenResponse = await fetch(
      'https://login.microsoftonline.com/common/oauth2/v2.0/token',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: tokenParams.toString()
      }
    );

    if (!tokenResponse.ok) {
      const errorData = await tokenResponse.json();
      throw new Error(`Error de Microsoft Token API: ${JSON.stringify(errorData)}`);
    }

    const tokenData = await tokenResponse.json();
    const { access_token, refresh_token, expires_in } = tokenData;
    
    // Calculamos el expiry_date sumando los segundos de expires_in a la hora actual
    const expiryDate = new Date(Date.now() + expires_in * 1000);

    if (role === 'DOCTOR') {
      const doctor = await prisma.doctorProfile.findUnique({ where: { userId } });
      if (!doctor) return res.status(404).json({ error: 'Perfil de médico no encontrado' });

      await prisma.doctorProfile.update({
        where: { id: doctor.id },
        data: {
          outlookAccessToken: access_token,
          ...(refresh_token && { outlookRefreshToken: refresh_token }),
          outlookTokenExpiry: expiryDate
        }
      });
    } else if (role === 'CLINIC_ADMIN') {
      const clinic = await prisma.clinicProfile.findUnique({ where: { userId } });
      if (!clinic) return res.status(404).json({ error: 'Perfil de clínica no encontrado' });

      await prisma.clinicProfile.update({
        where: { id: clinic.id },
        data: {
          outlookAccessToken: access_token,
          ...(refresh_token && { outlookRefreshToken: refresh_token }),
          outlookTokenExpiry: expiryDate
        }
      });
    } else {
      return res.status(403).json({ error: 'Rol no soportado para sincronización' });
    }

    res.status(200).json({ message: 'Calendario de Outlook sincronizado exitosamente. Ya puedes cerrar esta ventana.' });
  } catch (error: any) {
    console.error('[Calendar Controller] Error en outlookCallback:', error);
    res.status(500).json({ error: 'Error al procesar la respuesta de Microsoft' });
  }
};
