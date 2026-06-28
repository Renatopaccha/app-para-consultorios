import { google } from 'googleapis';
import prisma from '../prisma';

const getOAuth2Client = (accessToken: string, refreshToken: string) => {
  const oauth2Client = new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET,
    process.env.GOOGLE_REDIRECT_URI
  );
  
  oauth2Client.setCredentials({
    access_token: accessToken,
    refresh_token: refreshToken
  });
  
  return oauth2Client;
};

/**
 * Realiza una "lectura ciega" de los bloques ocupados del doctor.
 * @param doctorId ID del doctor en la base de datos
 * @param timeMin Fecha de inicio (ISO String)
 * @param timeMax Fecha de fin (ISO String)
 */
export const getDoctorAvailability = async (doctorId: string, timeMin: string, timeMax: string) => {
  const doctor = await prisma.doctorProfile.findUnique({ where: { id: doctorId } });
  
  if (!doctor || !doctor.googleRefreshToken) {
    throw new Error('El doctor no tiene sincronizado su Google Calendar');
  }

  const oauth2Client = getOAuth2Client(doctor.googleAccessToken || '', doctor.googleRefreshToken);
  const calendar = google.calendar({ version: 'v3', auth: oauth2Client });

  // La API FreeBusy garantiza máxima privacidad: solo devuelve rangos de tiempo (start/end)
  // omitiendo deliberadamente títulos, ubicaciones o asistentes de los eventos privados.
  const response = await calendar.freebusy.query({
    requestBody: {
      timeMin,
      timeMax,
      items: [{ id: 'primary' }]
    }
  });

  const busySlots = response.data.calendars?.['primary']?.busy || [];
  return busySlots;
};

/**
 * Realiza una "escritura anónima" en el calendario del doctor.
 * @param doctorId ID del doctor
 * @param startTime Fecha y hora de inicio de la cita (ISO String)
 * @param endTime Fecha y hora de fin de la cita (ISO String)
 */
export const blockVitaliTimeSlot = async (doctorId: string, startTime: string, endTime: string) => {
  const doctor = await prisma.doctorProfile.findUnique({ where: { id: doctorId } });
  
  if (!doctor || !doctor.googleRefreshToken) {
    throw new Error('El doctor no tiene sincronizado su Google Calendar');
  }

  const oauth2Client = getOAuth2Client(doctor.googleAccessToken || '', doctor.googleRefreshToken);
  const calendar = google.calendar({ version: 'v3', auth: oauth2Client });

  // Evento estrictamente anónimo sin incluir NINGÚN dato del paciente
  const event = {
    summary: 'Cita Vitali - Reservado',
    description: 'Bloque reservado automáticamente a través de Vitali. Consulta el panel médico para ver los detalles y la información del paciente.',
    start: {
      dateTime: startTime,
    },
    end: {
      dateTime: endTime,
    }
  };

  const response = await calendar.events.insert({
    calendarId: 'primary',
    requestBody: event
  });

  return response.data;
};
