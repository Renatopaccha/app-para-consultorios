import { google } from 'googleapis';
import prisma from '../prisma';

type CalendarPlatform = 'google' | 'outlook';
type CalendarTaskSuccess = { platform: CalendarPlatform; eventId?: string };
type CalendarTaskResult = CalendarTaskSuccess | null;
type CalendarCredentials = {
  googleAccessToken: string | null;
  googleRefreshToken: string | null;
  outlookAccessToken: string | null;
};

const GOOGLE_REDIRECT_URI = 'http://localhost:3000/api/calendar/google/callback';

function createGoogleClient(accessToken: string | null, refreshToken: string | null) {
  // OAuth2Client is mutable. A fresh instance prevents concurrent appointments
  // from replacing each other's credentials before Google sends the request.
  const client = new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET,
    GOOGLE_REDIRECT_URI,
  );
  client.setCredentials({ access_token: accessToken, refresh_token: refreshToken });
  return client;
}

function calendarCredentials(
  doctor: CalendarCredentials,
  clinic: CalendarCredentials,
): CalendarCredentials {
  // Creation uses the doctor's connected calendars whenever the doctor has at
  // least one provider configured; updates/deletes must use that same owner.
  const doctorHasProvider = Boolean(
    doctor.googleAccessToken || doctor.googleRefreshToken || doctor.outlookAccessToken,
  );
  return doctorHasProvider ? doctor : clinic;
}

function errorStatus(error: unknown): number | null {
  if (!error || typeof error !== 'object') return null;
  const candidate = error as { code?: unknown; response?: { status?: unknown } };
  if (typeof candidate.code === 'number') return candidate.code;
  if (typeof candidate.response?.status === 'number') return candidate.response.status;
  return null;
}

function logProviderFailure(operation: 'create' | 'update' | 'delete', platform: CalendarPlatform, error?: unknown) {
  const status = errorStatus(error);
  console.error(`[CalendarSync] ${operation} ${platform} failed${status ? ` (HTTP ${status})` : ''}`);
}

function successfulResults(results: PromiseSettledResult<CalendarTaskResult>[]): CalendarTaskSuccess[] {
  return results.flatMap((result): CalendarTaskSuccess[] => result.status === 'fulfilled' && result.value ? [result.value] : []);
}

function reportAggregate(operation: 'sync' | 'update' | 'delete', appointmentId: string, requested: number, succeeded: number) {
  if (succeeded === 0) {
    console.error(`[CalendarSync] ${operation} failed for appointment ${appointmentId}: no provider succeeded.`);
  } else if (succeeded < requested) {
    console.warn(`[CalendarSync] ${operation} partially completed for appointment ${appointmentId}: ${succeeded}/${requested} providers succeeded.`);
  } else {
    console.log(`[CalendarSync] ${operation} completed for appointment ${appointmentId}: ${succeeded}/${requested} providers succeeded.`);
  }
}

export const syncAppointmentToCalendar = async (appointmentId: string): Promise<boolean> => {
  try {
    const appointment = await prisma.appointment.findUnique({
      where: { id: appointmentId },
      include: {
        patient: true,
        patientInvitation: { select: { email: true, firstName: true, lastName: true, phone: true } },
        doctorProfile: true,
        clinicProfile: true,
        service: true,
      },
    });

    if (!appointment) {
      console.warn(`[CalendarSync] Cannot sync missing appointment ${appointmentId}.`);
      return false;
    }

    const timeZone = 'America/Guayaquil';
    const dateStr = appointment.date.toISOString().split('T')[0];
    const startDateTime = `${dateStr}T${appointment.startTime}:00-05:00`;
    const endDateTime = `${dateStr}T${appointment.endTime}:00-05:00`;
    const patient = appointment.patient || appointment.patientInvitation || {
      firstName: appointment.invitedPatientFirstName || 'Paciente',
      lastName: appointment.invitedPatientLastName || 'invitado',
      email: appointment.invitedPatientEmail || '',
      phone: appointment.invitedPatientPhone,
    };
    const eventTitle = appointment.paymentStatus === 'PENDING_CASH'
      ? appointment.patientConfirmationStatus === 'CONFIRMED'
        ? `Asistencia Confirmada (Falta Pago Efectivo) - ${patient.firstName} ${patient.lastName}`
        : `Reserva - Falta confirmar asistencia (Pago Pendiente) - ${patient.firstName} ${patient.lastName}`
      : `Cita Zenda - ${patient.firstName} ${patient.lastName}`;
    const eventDescription = `Servicio: ${appointment.service.name}\nPaciente: ${patient.email}\nTeléfono: ${patient.phone || 'No registrado'}`;
    const credentials = calendarCredentials(appointment.doctorProfile, appointment.clinicProfile);
    const tasks: Promise<CalendarTaskResult>[] = [];

    if (credentials.googleAccessToken || credentials.googleRefreshToken) {
      tasks.push(syncToGoogleCalendar(credentials.googleAccessToken, credentials.googleRefreshToken, eventTitle, eventDescription, startDateTime, endDateTime, timeZone));
    }
    if (credentials.outlookAccessToken) {
      tasks.push(syncToOutlookCalendar(credentials.outlookAccessToken, eventTitle, eventDescription, startDateTime, endDateTime, timeZone));
    }
    if (tasks.length === 0) {
      console.log(`[CalendarSync] No configured calendar provider for appointment ${appointmentId}.`);
      return false;
    }

    const results = await Promise.allSettled(tasks);
    const succeeded = successfulResults(results);
    reportAggregate('sync', appointmentId, tasks.length, succeeded.length);
    if (succeeded.length === 0) return false;

    const googleEventId = succeeded.find((result) => result.platform === 'google')?.eventId;
    const outlookEventId = succeeded.find((result) => result.platform === 'outlook')?.eventId;
    await prisma.appointment.update({
      where: { id: appointmentId },
      data: {
        ...(googleEventId ? { googleEventId } : {}),
        ...(outlookEventId ? { outlookEventId } : {}),
      },
    });
    return true;
  } catch (error) {
    console.error(`[CalendarSync] Sync failed for appointment ${appointmentId}:`, error instanceof Error ? error.message : 'unknown error');
    return false;
  }
};

export const updateCalendarEventStatus = async (appointmentId: string): Promise<boolean> => {
  try {
    const appointment = await prisma.appointment.findUnique({
      where: { id: appointmentId },
      include: {
        patient: true,
        patientInvitation: { select: { firstName: true, lastName: true } },
        doctorProfile: true,
        clinicProfile: true,
      },
    });
    if (!appointment) {
      console.warn(`[CalendarSync] Cannot update missing appointment ${appointmentId}.`);
      return false;
    }

    const patient = appointment.patient || appointment.patientInvitation || {
      firstName: appointment.invitedPatientFirstName || 'Paciente',
      lastName: appointment.invitedPatientLastName || 'invitado',
    };
    const title = appointment.paymentStatus === 'PENDING_CASH'
      ? appointment.patientConfirmationStatus === 'CONFIRMED'
        ? `Asistencia Confirmada (Falta Pago Efectivo) - ${patient.firstName} ${patient.lastName}`
        : `Reserva - Falta confirmar asistencia (Pago Pendiente) - ${patient.firstName} ${patient.lastName}`
      : `Cita Zenda - ${patient.firstName} ${patient.lastName}`;
    const credentials = calendarCredentials(appointment.doctorProfile, appointment.clinicProfile);
    const tasks: Promise<CalendarTaskResult>[] = [];

    if (appointment.googleEventId && (credentials.googleAccessToken || credentials.googleRefreshToken)) {
      tasks.push(updateGoogleEvent(credentials.googleAccessToken, credentials.googleRefreshToken, appointment.googleEventId, title));
    }
    if (appointment.outlookEventId && credentials.outlookAccessToken) {
      tasks.push(updateOutlookEvent(credentials.outlookAccessToken, appointment.outlookEventId, title));
    }
    if (tasks.length === 0) {
      console.log(`[CalendarSync] No configured event provider to update for appointment ${appointmentId}.`);
      return false;
    }

    const results = await Promise.allSettled(tasks);
    const succeeded = successfulResults(results);
    reportAggregate('update', appointmentId, tasks.length, succeeded.length);
    return succeeded.length > 0;
  } catch (error) {
    console.error(`[CalendarSync] Update failed for appointment ${appointmentId}:`, error instanceof Error ? error.message : 'unknown error');
    return false;
  }
};

export const deleteCalendarEvent = async (appointmentId: string): Promise<boolean> => {
  try {
    const appointment = await prisma.appointment.findUnique({
      where: { id: appointmentId },
      include: { doctorProfile: true, clinicProfile: true },
    });
    if (!appointment) {
      console.warn(`[CalendarSync] Cannot delete calendar events for missing appointment ${appointmentId}.`);
      return false;
    }

    const credentials = calendarCredentials(appointment.doctorProfile, appointment.clinicProfile);
    const tasks: Promise<CalendarTaskResult>[] = [];
    if (appointment.googleEventId && (credentials.googleAccessToken || credentials.googleRefreshToken)) {
      tasks.push(deleteGoogleEvent(credentials.googleAccessToken, credentials.googleRefreshToken, appointment.googleEventId));
    }
    if (appointment.outlookEventId && credentials.outlookAccessToken) {
      tasks.push(deleteOutlookEvent(credentials.outlookAccessToken, appointment.outlookEventId));
    }
    if (tasks.length === 0) {
      console.log(`[CalendarSync] No configured event provider to delete for appointment ${appointmentId}.`);
      return false;
    }

    const results = await Promise.allSettled(tasks);
    const succeeded = successfulResults(results);
    reportAggregate('delete', appointmentId, tasks.length, succeeded.length);
    return succeeded.length > 0;
  } catch (error) {
    console.error(`[CalendarSync] Delete failed for appointment ${appointmentId}:`, error instanceof Error ? error.message : 'unknown error');
    return false;
  }
};

async function syncToGoogleCalendar(accessToken: string | null, refreshToken: string | null, summary: string, description: string, startDateTime: string, endDateTime: string, timeZone: string): Promise<CalendarTaskResult> {
  try {
    const calendar = google.calendar({ version: 'v3', auth: createGoogleClient(accessToken, refreshToken) });
    const response = await calendar.events.insert({ calendarId: 'primary', requestBody: { summary, description, start: { dateTime: startDateTime, timeZone }, end: { dateTime: endDateTime, timeZone } } });
    if (!response.data.id) {
      logProviderFailure('create', 'google');
      return null;
    }
    return { platform: 'google', eventId: response.data.id };
  } catch (error) {
    logProviderFailure('create', 'google', error);
    return null;
  }
}

async function syncToOutlookCalendar(accessToken: string, subject: string, content: string, startDateTime: string, endDateTime: string, timeZone: string): Promise<CalendarTaskResult> {
  try {
    const response = await fetch('https://graph.microsoft.com/v1.0/me/events', {
      method: 'POST',
      headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ subject, body: { contentType: 'HTML', content: content.replace(/\n/g, '<br>') }, start: { dateTime: startDateTime.slice(0, 19), timeZone }, end: { dateTime: endDateTime.slice(0, 19), timeZone } }),
    });
    if (!response.ok) {
      logProviderFailure('create', 'outlook', { response: { status: response.status } });
      return null;
    }
    const data = await response.json() as { id?: unknown };
    return typeof data.id === 'string' && data.id ? { platform: 'outlook', eventId: data.id } : null;
  } catch (error) {
    logProviderFailure('create', 'outlook', error);
    return null;
  }
}

async function updateGoogleEvent(accessToken: string | null, refreshToken: string | null, eventId: string, summary: string): Promise<CalendarTaskResult> {
  try {
    const calendar = google.calendar({ version: 'v3', auth: createGoogleClient(accessToken, refreshToken) });
    await calendar.events.patch({ calendarId: 'primary', eventId, requestBody: { summary } });
    return { platform: 'google' };
  } catch (error) {
    logProviderFailure('update', 'google', error);
    return null;
  }
}

async function updateOutlookEvent(accessToken: string, eventId: string, subject: string): Promise<CalendarTaskResult> {
  try {
    const response = await fetch(`https://graph.microsoft.com/v1.0/me/events/${eventId}`, { method: 'PATCH', headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ subject }) });
    if (!response.ok) {
      logProviderFailure('update', 'outlook', { response: { status: response.status } });
      return null;
    }
    return { platform: 'outlook' };
  } catch (error) {
    logProviderFailure('update', 'outlook', error);
    return null;
  }
}

async function deleteGoogleEvent(accessToken: string | null, refreshToken: string | null, eventId: string): Promise<CalendarTaskResult> {
  try {
    const calendar = google.calendar({ version: 'v3', auth: createGoogleClient(accessToken, refreshToken) });
    await calendar.events.delete({ calendarId: 'primary', eventId });
    return { platform: 'google' };
  } catch (error) {
    // Deletion is idempotent: a missing remote event already satisfies the goal.
    if (errorStatus(error) === 404) return { platform: 'google' };
    logProviderFailure('delete', 'google', error);
    return null;
  }
}

async function deleteOutlookEvent(accessToken: string, eventId: string): Promise<CalendarTaskResult> {
  try {
    const response = await fetch(`https://graph.microsoft.com/v1.0/me/events/${eventId}`, { method: 'DELETE', headers: { Authorization: `Bearer ${accessToken}` } });
    // Microsoft Graph 404 is also treated as idempotent success: the desired
    // postcondition is that the event is absent.
    if (response.ok || response.status === 404) return { platform: 'outlook' };
    logProviderFailure('delete', 'outlook', { response: { status: response.status } });
    return null;
  } catch (error) {
    logProviderFailure('delete', 'outlook', error);
    return null;
  }
}
