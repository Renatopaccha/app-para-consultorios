import { Request, Response } from 'express';
import { google } from 'googleapis';
import prisma from '../prisma';
import { AuthRequest } from '../middlewares/auth.middleware';
import { getOutlookConfig, OutlookConfigurationError, outlookOAuthBaseUrl } from '../config/outlook';

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

function outlookConfigurationResponse(error: unknown, res: Response): boolean {
  if (!(error instanceof OutlookConfigurationError)) return false;
  console.error(JSON.stringify({ event: 'outlook_configuration_missing', missing: error.missing }));
  res.status(503).json({ error: 'OUTLOOK_NOT_CONFIGURED', message: 'La sincronización de Outlook no está configurada actualmente.' });
  return true;
}

function tokenFields(value: unknown): { accessToken: string; refreshToken: string | null; expiresIn: number } {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('INVALID_OUTLOOK_TOKEN_RESPONSE');
  const data = value as Record<string, unknown>;
  if (typeof data.access_token !== 'string' || typeof data.expires_in !== 'number') throw new Error('INVALID_OUTLOOK_TOKEN_RESPONSE');
  return { accessToken: data.access_token, refreshToken: typeof data.refresh_token === 'string' ? data.refresh_token : null, expiresIn: data.expires_in };
}

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

    const config = getOutlookConfig();
    const statePayload = Buffer.from(JSON.stringify({ userId, role })).toString('base64');
    
    // Scopes requeridos para Outlook
    const scopes = 'offline_access https://graph.microsoft.com/Calendars.ReadWrite https://graph.microsoft.com/Calendars.ReadWrite.Shared';

    // Para Microsoft se recomienda usar URLSearchParams para armar la URL
    const params = new URLSearchParams({
      client_id: config.clientId,
      response_type: 'code',
      redirect_uri: config.redirectUri,
      response_mode: 'query',
      scope: scopes,
      state: statePayload
    });

    const authUrl = `${outlookOAuthBaseUrl(config)}/authorize?${params.toString()}`;

    res.status(200).json({ url: authUrl });
  } catch (error) {
    if (outlookConfigurationResponse(error, res)) return;
    console.error('[Calendar Controller] Error en getOutlookAuthUrl:', error);
    res.status(500).json({ error: 'Error al generar la URL de autenticación de Outlook' });
  }
};

export const outlookCallback = async (req: Request, res: Response) => {
  try {
    const config = getOutlookConfig();
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
      client_id: config.clientId,
      client_secret: config.clientSecret,
      code,
      redirect_uri: config.redirectUri,
      grant_type: 'authorization_code'
    });

    const tokenResponse = await fetch(
      `${outlookOAuthBaseUrl(config)}/token`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: tokenParams.toString()
      }
    );

    if (!tokenResponse.ok) {
      throw new Error(`OUTLOOK_TOKEN_REQUEST_FAILED_${tokenResponse.status}`);
    }

    const { accessToken, refreshToken, expiresIn } = tokenFields(await tokenResponse.json());
    
    // Calculamos el expiry_date sumando los segundos de expires_in a la hora actual
    const expiryDate = new Date(Date.now() + expiresIn * 1000);

    if (role === 'DOCTOR') {
      const doctor = await prisma.doctorProfile.findUnique({ where: { userId } });
      if (!doctor) return res.status(404).json({ error: 'Perfil de médico no encontrado' });

      await prisma.doctorProfile.update({
        where: { id: doctor.id },
        data: {
          outlookAccessToken: accessToken,
          ...(refreshToken && { outlookRefreshToken: refreshToken }),
          outlookTokenExpiry: expiryDate
        }
      });
    } else if (role === 'CLINIC_ADMIN') {
      const clinic = await prisma.clinicProfile.findUnique({ where: { userId } });
      if (!clinic) return res.status(404).json({ error: 'Perfil de clínica no encontrado' });

      await prisma.clinicProfile.update({
        where: { id: clinic.id },
        data: {
          outlookAccessToken: accessToken,
          ...(refreshToken && { outlookRefreshToken: refreshToken }),
          outlookTokenExpiry: expiryDate
        }
      });
    } else {
      return res.status(403).json({ error: 'Rol no soportado para sincronización' });
    }

    res.status(200).json({ message: 'Calendario de Outlook sincronizado exitosamente. Ya puedes cerrar esta ventana.' });
  } catch (error: unknown) {
    if (outlookConfigurationResponse(error, res)) return;
    console.error('[Calendar Controller] Error en outlookCallback:', error instanceof Error ? error.name : 'UnknownError');
    res.status(500).json({ error: 'Error al procesar la respuesta de Microsoft' });
  }
};
