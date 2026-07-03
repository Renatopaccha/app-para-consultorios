import { google } from 'googleapis';
import prisma from '../prisma';

const oauth2Client = new google.auth.OAuth2(
  process.env.GOOGLE_CLIENT_ID,
  process.env.GOOGLE_CLIENT_SECRET,
  'http://localhost:3000/api/calendar/google/callback'
);

export const syncAppointmentToCalendar = async (appointmentId: string): Promise<boolean> => {
  try {
    const appointment = await prisma.appointment.findUnique({
      where: { id: appointmentId },
      include: {
        patient: true,
        doctorProfile: true,
        clinicProfile: true,
        service: true
      }
    });

    if (!appointment) {
      throw new Error(`No se encontró la cita con ID ${appointmentId}`);
    }

    const timeZone = 'America/Guayaquil';
    const dateStr = appointment.date.toISOString().split('T')[0]; 
    const startDateTime = `${dateStr}T${appointment.startTime}:00-05:00`;
    const endDateTime = `${dateStr}T${appointment.endTime}:00-05:00`;

    let eventTitle = `Cita Zenda - ${appointment.patient.firstName} ${appointment.patient.lastName}`;
    
    if (appointment.paymentStatus === 'PENDING_CASH') {
      if (appointment.isPatientConfirmed) {
        eventTitle = `Asistencia Confirmada (Falta Pago Efectivo) - ${appointment.patient.firstName} ${appointment.patient.lastName}`;
      } else {
        eventTitle = `Reserva - Falta confirmar asistencia (Pago Pendiente) - ${appointment.patient.firstName} ${appointment.patient.lastName}`;
      }
    }

    const eventDescription = `Servicio: ${appointment.service.name}\nPaciente: ${appointment.patient.email}\nTeléfono: ${appointment.patient.phone || 'No registrado'}`;

    const doc = appointment.doctorProfile;
    const clinic = appointment.clinicProfile;

    const syncTasks: Promise<{ platform: 'google'|'outlook', eventId: string } | null>[] = [];

    if ((doc.googleRefreshToken || doc.googleAccessToken) || (doc.outlookRefreshToken || doc.outlookAccessToken)) {
      if (doc.googleRefreshToken || doc.googleAccessToken) {
        syncTasks.push(syncToGoogleCalendar(doc.googleAccessToken, doc.googleRefreshToken, eventTitle, eventDescription, startDateTime, endDateTime, timeZone));
      }
      if (doc.outlookRefreshToken || doc.outlookAccessToken) {
        syncTasks.push(syncToOutlookCalendar(doc.outlookAccessToken, eventTitle, eventDescription, startDateTime, endDateTime, timeZone));
      }
    } else {
      if (clinic.googleRefreshToken || clinic.googleAccessToken) {
        syncTasks.push(syncToGoogleCalendar(clinic.googleAccessToken, clinic.googleRefreshToken, eventTitle, eventDescription, startDateTime, endDateTime, timeZone));
      }
      if (clinic.outlookRefreshToken || clinic.outlookAccessToken) {
        syncTasks.push(syncToOutlookCalendar(clinic.outlookAccessToken, eventTitle, eventDescription, startDateTime, endDateTime, timeZone));
      }
    }

    if (syncTasks.length === 0) {
      console.log(`[CalendarSync] No hay tokens configurados para la cita ${appointmentId}`);
      return false;
    }

    const results = await Promise.allSettled(syncTasks);
    
    let googleEventId: string | null = null;
    let outlookEventId: string | null = null;

    results.forEach(result => {
      if (result.status === 'fulfilled' && result.value) {
        if (result.value.platform === 'google') googleEventId = result.value.eventId;
        if (result.value.platform === 'outlook') outlookEventId = result.value.eventId;
      }
    });

    if (googleEventId || outlookEventId) {
      await prisma.appointment.update({
        where: { id: appointmentId },
        data: {
          ...(googleEventId ? { googleEventId } : {}),
          ...(outlookEventId ? { outlookEventId } : {})
        }
      });
    }

    return true;

  } catch (error) {
    console.error(`[CalendarSync] Error al sincronizar la cita ${appointmentId}:`, error);
    return false;
  }
};

export const updateCalendarEventStatus = async (appointmentId: string): Promise<boolean> => {
  try {
    const appointment = await prisma.appointment.findUnique({
      where: { id: appointmentId },
      include: {
        patient: true,
        doctorProfile: true,
        clinicProfile: true
      }
    });

    if (!appointment) throw new Error('Cita no encontrada');

    let newTitle = `Cita Zenda - ${appointment.patient.firstName} ${appointment.patient.lastName}`;
    
    if (appointment.paymentStatus === 'PENDING_CASH') {
      if (appointment.isPatientConfirmed) {
        newTitle = `Asistencia Confirmada (Falta Pago Efectivo) - ${appointment.patient.firstName} ${appointment.patient.lastName}`;
      } else {
        newTitle = `Reserva - Falta confirmar asistencia (Pago Pendiente) - ${appointment.patient.firstName} ${appointment.patient.lastName}`;
      }
    }
    const doc = appointment.doctorProfile;
    const clinic = appointment.clinicProfile;
    
    const updateTasks: Promise<any>[] = [];

    if (appointment.googleEventId) {
      const gAccessToken = doc.googleAccessToken || clinic.googleAccessToken;
      const gRefreshToken = doc.googleRefreshToken || clinic.googleRefreshToken;
      
      if (gAccessToken || gRefreshToken) {
        oauth2Client.setCredentials({ access_token: gAccessToken, refresh_token: gRefreshToken });
        const calendar = google.calendar({ version: 'v3', auth: oauth2Client });
        updateTasks.push(
          calendar.events.patch({
            calendarId: 'primary',
            eventId: appointment.googleEventId,
            requestBody: { summary: newTitle }
          })
        );
      }
    }

    if (appointment.outlookEventId) {
      const oAccessToken = doc.outlookAccessToken || clinic.outlookAccessToken;
      if (oAccessToken) {
        updateTasks.push(
          fetch(`https://graph.microsoft.com/v1.0/me/events/${appointment.outlookEventId}`, {
            method: 'PATCH',
            headers: {
              'Authorization': `Bearer ${oAccessToken}`,
              'Content-Type': 'application/json'
            },
            body: JSON.stringify({ subject: newTitle })
          })
        );
      }
    }

    if (updateTasks.length > 0) {
      await Promise.allSettled(updateTasks);
      console.log(`[CalendarSync] Evento actualizado para la cita ${appointmentId}`);
    }

    return true;
  } catch (error) {
    console.error(`[CalendarSync] Error al actualizar el evento de la cita ${appointmentId}:`, error);
    return false;
  }
};

export const deleteCalendarEvent = async (appointmentId: string): Promise<boolean> => {
  try {
    const appointment = await prisma.appointment.findUnique({
      where: { id: appointmentId },
      include: {
        doctorProfile: true,
        clinicProfile: true
      }
    });

    if (!appointment) throw new Error('Cita no encontrada');

    const doc = appointment.doctorProfile;
    const clinic = appointment.clinicProfile;
    
    const deleteTasks: Promise<any>[] = [];

    if (appointment.googleEventId) {
      const gAccessToken = doc.googleAccessToken || clinic.googleAccessToken;
      const gRefreshToken = doc.googleRefreshToken || clinic.googleRefreshToken;
      
      if (gAccessToken || gRefreshToken) {
        oauth2Client.setCredentials({ access_token: gAccessToken, refresh_token: gRefreshToken });
        const calendar = google.calendar({ version: 'v3', auth: oauth2Client });
        deleteTasks.push(
          calendar.events.delete({
            calendarId: 'primary',
            eventId: appointment.googleEventId
          })
        );
      }
    }

    if (appointment.outlookEventId) {
      const oAccessToken = doc.outlookAccessToken || clinic.outlookAccessToken;
      if (oAccessToken) {
        deleteTasks.push(
          fetch(`https://graph.microsoft.com/v1.0/me/events/${appointment.outlookEventId}`, {
            method: 'DELETE',
            headers: { 'Authorization': `Bearer ${oAccessToken}` }
          })
        );
      }
    }

    if (deleteTasks.length > 0) {
      await Promise.allSettled(deleteTasks);
      console.log(`[CalendarSync] Evento eliminado para la cita ${appointmentId}`);
    }

    return true;
  } catch (error) {
    console.error(`[CalendarSync] Error al eliminar el evento de la cita ${appointmentId}:`, error);
    return false;
  }
};


// -------------------------------------------------------------
// HELPERS DE SINCRONIZACIÓN
// -------------------------------------------------------------

async function syncToGoogleCalendar(
  accessToken: string | null,
  refreshToken: string | null,
  summary: string,
  description: string,
  startDateTime: string,
  endDateTime: string,
  timeZone: string
): Promise<{ platform: 'google', eventId: string } | null> {
  try {
    oauth2Client.setCredentials({
      access_token: accessToken,
      refresh_token: refreshToken
    });

    const calendar = google.calendar({ version: 'v3', auth: oauth2Client });
    
    const response = await calendar.events.insert({
      calendarId: 'primary',
      requestBody: {
        summary,
        description,
        start: { dateTime: startDateTime, timeZone },
        end: { dateTime: endDateTime, timeZone }
      }
    });

    console.log('[CalendarSync] Evento creado en Google Calendar exitosamente.');
    return { platform: 'google', eventId: response.data.id as string };
  } catch (error) {
    console.error('[CalendarSync] Error conectando con Google Calendar API:', error);
    return null;
  }
}

async function syncToOutlookCalendar(
  accessToken: string | null,
  subject: string,
  content: string,
  startDateTime: string,
  endDateTime: string,
  timeZone: string
): Promise<{ platform: 'outlook', eventId: string } | null> {
  if (!accessToken) return null;

  try {
    const eventPayload = {
      subject,
      body: {
        contentType: 'HTML',
        content: content.replace(/\n/g, '<br>')
      },
      start: {
        dateTime: startDateTime.slice(0, 19), 
        timeZone
      },
      end: {
        dateTime: endDateTime.slice(0, 19),
        timeZone
      }
    };

    const response = await fetch('https://graph.microsoft.com/v1.0/me/events', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(eventPayload)
    });

    if (!response.ok) {
      const errorData = await response.json();
      console.error(`Graph API Error: ${JSON.stringify(errorData)}`);
      return null;
    }

    const data = await response.json();
    console.log('[CalendarSync] Evento creado en Outlook Calendar exitosamente.');
    return { platform: 'outlook', eventId: data.id };
  } catch (error) {
    console.error('[CalendarSync] Error conectando con Microsoft Graph API:', error);
    return null;
  }
}
