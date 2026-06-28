import { Response } from 'express';
import { google } from 'googleapis';
import prisma from '../prisma';
import { AuthRequest } from '../middlewares/auth.middleware';

const getOAuth2Client = () => {
  return new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET,
    process.env.GOOGLE_REDIRECT_URI
  );
};

export const generateAuthUrl = async (req: AuthRequest, res: Response) => {
  try {
    const oauth2Client = getOAuth2Client();

    // Requerimos permisos de lectura y escritura de calendario
    const scopes = [
      'https://www.googleapis.com/auth/calendar',
      'https://www.googleapis.com/auth/calendar.events'
    ];

    const url = oauth2Client.generateAuthUrl({
      access_type: 'offline', // Importante para obtener el refresh_token
      prompt: 'consent', // Forzamos el prompt para asegurar que nos den el refresh_token
      scope: scopes,
      // Pasamos el ID del usuario en el state (útil si se decide cambiar a un flujo GET directo)
      state: req.user?.id 
    });

    res.json({ url });
  } catch (error) {
    console.error('[Google Auth] Error generando URL:', error);
    res.status(500).json({ error: 'Error al generar URL de autorización' });
  }
};

export const handleGoogleCallback = async (req: AuthRequest, res: Response) => {
  try {
    const { code } = req.body; // El frontend (app o web) obtiene el code y nos lo envía
    const userId = req.user?.id;

    if (!code) {
      return res.status(400).json({ error: 'No se proporcionó el código de autorización' });
    }

    if (!userId) {
      return res.status(401).json({ error: 'Usuario no autenticado' });
    }

    const doctor = await prisma.doctorProfile.findUnique({
      where: { userId }
    });

    if (!doctor) {
      return res.status(404).json({ error: 'Perfil de doctor no encontrado' });
    }

    const oauth2Client = getOAuth2Client();
    // Intercambiamos el authorization code por los tokens
    const { tokens } = await oauth2Client.getToken(code);

    // Guardamos los tokens de forma segura en el registro del Doctor
    await prisma.doctorProfile.update({
      where: { id: doctor.id },
      data: {
        googleAccessToken: tokens.access_token,
        // Google no siempre devuelve el refresh_token si ya lo dio antes.
        // Solo lo actualizamos si viene uno nuevo, sino conservamos el existente.
        googleRefreshToken: tokens.refresh_token || doctor.googleRefreshToken, 
        tokenExpiry: tokens.expiry_date ? new Date(tokens.expiry_date) : null
      }
    });

    res.json({ success: true, message: 'Calendario de Google sincronizado correctamente' });
  } catch (error) {
    console.error('[Google Auth] Error en callback:', error);
    res.status(500).json({ error: 'Error al procesar la autorización de Google' });
  }
};
