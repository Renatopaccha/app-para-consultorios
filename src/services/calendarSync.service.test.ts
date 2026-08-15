const prismaMock = {
  appointment: { findUnique: jest.fn(), update: jest.fn() },
};

const googleInstances: Array<{ credentials?: Record<string, unknown>; setCredentials: jest.Mock }> = [];
const googleEvents = {
  insert: jest.fn(),
  patch: jest.fn(),
  delete: jest.fn(),
};

jest.mock('../prisma', () => ({ __esModule: true, default: prismaMock }));
jest.mock('googleapis', () => ({
  google: {
    auth: {
      OAuth2: jest.fn().mockImplementation(() => {
        const instance = {
          setCredentials: jest.fn(function setCredentials(this: { credentials?: Record<string, unknown> }, credentials: Record<string, unknown>) {
            this.credentials = credentials;
          }),
        };
        googleInstances.push(instance);
        return instance;
      }),
    },
    calendar: jest.fn(({ auth }) => ({ events: googleEvents, auth })),
  },
}));

import { deleteCalendarEvent, syncAppointmentToCalendar, updateCalendarEventStatus } from './calendarSync.service';

const mockedFetch = jest.fn();
global.fetch = mockedFetch as unknown as typeof fetch;

const response = (status: number, data: unknown = {}) => ({ ok: status >= 200 && status < 300, status, json: jest.fn().mockResolvedValue(data) });

function appointment(overrides: Record<string, unknown> = {}) {
  return {
    id: 'appointment-1',
    date: new Date('2026-10-05T05:00:00.000Z'),
    startTime: '09:00',
    endTime: '09:30',
    paymentStatus: 'PAID',
    patientConfirmationStatus: 'PENDING',
    patient: { firstName: 'Ada', lastName: 'Paciente', email: 'ada@example.test', phone: null },
    patientInvitation: null,
    invitedPatientFirstName: null,
    invitedPatientLastName: null,
    invitedPatientEmail: null,
    invitedPatientPhone: null,
    service: { name: 'Consulta' },
    googleEventId: null,
    outlookEventId: null,
    doctorProfile: { googleAccessToken: null, googleRefreshToken: null, outlookAccessToken: null },
    clinicProfile: { googleAccessToken: null, googleRefreshToken: null, outlookAccessToken: null },
    ...overrides,
  };
}

describe('calendarSync.service', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    googleInstances.splice(0);
    prismaMock.appointment.update.mockResolvedValue({});
    googleEvents.insert.mockResolvedValue({ data: { id: 'google-event' } });
    googleEvents.patch.mockResolvedValue({ data: {} });
    googleEvents.delete.mockResolvedValue({ data: {} });
  });

  it('returns false for a missing appointment', async () => {
    prismaMock.appointment.findUnique.mockResolvedValue(null);
    await expect(syncAppointmentToCalendar('missing')).resolves.toBe(false);
    await expect(updateCalendarEventStatus('missing')).resolves.toBe(false);
    await expect(deleteCalendarEvent('missing')).resolves.toBe(false);
  });

  it('returns false when no provider is configured', async () => {
    prismaMock.appointment.findUnique.mockResolvedValue(appointment());
    await expect(syncAppointmentToCalendar('appointment-1')).resolves.toBe(false);
    expect(prismaMock.appointment.update).not.toHaveBeenCalled();
  });

  it('persists a Google event when Google succeeds', async () => {
    prismaMock.appointment.findUnique.mockResolvedValue(appointment({ doctorProfile: { googleAccessToken: 'google-a', googleRefreshToken: null, outlookAccessToken: null } }));
    await expect(syncAppointmentToCalendar('appointment-1')).resolves.toBe(true);
    expect(prismaMock.appointment.update).toHaveBeenCalledWith(expect.objectContaining({ data: { googleEventId: 'google-event' } }));
  });

  it('returns false when Google creation fails', async () => {
    prismaMock.appointment.findUnique.mockResolvedValue(appointment({ doctorProfile: { googleAccessToken: 'google-a', googleRefreshToken: null, outlookAccessToken: null } }));
    googleEvents.insert.mockRejectedValue({ code: 500 });
    await expect(syncAppointmentToCalendar('appointment-1')).resolves.toBe(false);
    expect(prismaMock.appointment.update).not.toHaveBeenCalled();
  });

  it('persists an Outlook event when Outlook succeeds', async () => {
    prismaMock.appointment.findUnique.mockResolvedValue(appointment({ doctorProfile: { googleAccessToken: null, googleRefreshToken: null, outlookAccessToken: 'outlook-a' } }));
    mockedFetch.mockResolvedValue(response(201, { id: 'outlook-event' }));
    await expect(syncAppointmentToCalendar('appointment-1')).resolves.toBe(true);
    expect(prismaMock.appointment.update).toHaveBeenCalledWith(expect.objectContaining({ data: { outlookEventId: 'outlook-event' } }));
  });

  it.each([401, 500])('treats Outlook create HTTP %i as failure', async (status) => {
    prismaMock.appointment.findUnique.mockResolvedValue(appointment({ doctorProfile: { googleAccessToken: null, googleRefreshToken: null, outlookAccessToken: 'outlook-a' } }));
    mockedFetch.mockResolvedValue(response(status));
    await expect(syncAppointmentToCalendar('appointment-1')).resolves.toBe(false);
  });

  it('reports partial success when Google succeeds and Outlook fails', async () => {
    prismaMock.appointment.findUnique.mockResolvedValue(appointment({ doctorProfile: { googleAccessToken: 'google-a', googleRefreshToken: null, outlookAccessToken: 'outlook-a' } }));
    mockedFetch.mockResolvedValue(response(500));
    await expect(syncAppointmentToCalendar('appointment-1')).resolves.toBe(true);
    expect(prismaMock.appointment.update).toHaveBeenCalledWith(expect.objectContaining({ data: { googleEventId: 'google-event' } }));
  });

  it('returns false when both configured providers fail', async () => {
    prismaMock.appointment.findUnique.mockResolvedValue(appointment({ doctorProfile: { googleAccessToken: 'google-a', googleRefreshToken: null, outlookAccessToken: 'outlook-a' } }));
    googleEvents.insert.mockRejectedValue({ code: 500 });
    mockedFetch.mockResolvedValue(response(500));
    await expect(syncAppointmentToCalendar('appointment-1')).resolves.toBe(false);
  });

  it('returns true for update partial success and false when every update fails', async () => {
    const current = appointment({ googleEventId: 'google-event', outlookEventId: 'outlook-event', doctorProfile: { googleAccessToken: 'google-a', googleRefreshToken: null, outlookAccessToken: 'outlook-a' } });
    prismaMock.appointment.findUnique.mockResolvedValue(current);
    mockedFetch.mockResolvedValue(response(500));
    await expect(updateCalendarEventStatus('appointment-1')).resolves.toBe(true);

    googleEvents.patch.mockRejectedValue({ code: 500 });
    await expect(updateCalendarEventStatus('appointment-1')).resolves.toBe(false);
  });

  it.each([401, 500])('treats Outlook update HTTP %i as failure', async (status) => {
    prismaMock.appointment.findUnique.mockResolvedValue(appointment({ outlookEventId: 'outlook-event', doctorProfile: { googleAccessToken: null, googleRefreshToken: null, outlookAccessToken: 'outlook-a' } }));
    mockedFetch.mockResolvedValue(response(status));
    await expect(updateCalendarEventStatus('appointment-1')).resolves.toBe(false);
  });

  it('returns true for delete partial success and false when every delete fails', async () => {
    const current = appointment({ googleEventId: 'google-event', outlookEventId: 'outlook-event', doctorProfile: { googleAccessToken: 'google-a', googleRefreshToken: null, outlookAccessToken: 'outlook-a' } });
    prismaMock.appointment.findUnique.mockResolvedValue(current);
    mockedFetch.mockResolvedValue(response(500));
    await expect(deleteCalendarEvent('appointment-1')).resolves.toBe(true);

    googleEvents.delete.mockRejectedValue({ code: 500 });
    await expect(deleteCalendarEvent('appointment-1')).resolves.toBe(false);
  });

  it('treats Outlook DELETE 404 as idempotent success', async () => {
    prismaMock.appointment.findUnique.mockResolvedValue(appointment({ outlookEventId: 'outlook-event', doctorProfile: { googleAccessToken: null, googleRefreshToken: null, outlookAccessToken: 'outlook-a' } }));
    mockedFetch.mockResolvedValue(response(404));
    await expect(deleteCalendarEvent('appointment-1')).resolves.toBe(true);
  });

  it('uses independent OAuth clients for concurrent Google synchronizations', async () => {
    prismaMock.appointment.findUnique
      .mockResolvedValueOnce(appointment({ id: 'a', doctorProfile: { googleAccessToken: 'google-user-a', googleRefreshToken: 'refresh-a', outlookAccessToken: null } }))
      .mockResolvedValueOnce(appointment({ id: 'b', doctorProfile: { googleAccessToken: 'google-user-b', googleRefreshToken: 'refresh-b', outlookAccessToken: null } }));
    googleEvents.insert.mockImplementation(async () => ({ data: { id: `event-${googleInstances.length}` } }));

    await expect(Promise.all([syncAppointmentToCalendar('a'), syncAppointmentToCalendar('b')])).resolves.toEqual([true, true]);
    expect(googleInstances).toHaveLength(2);
    expect(googleInstances[0]).not.toBe(googleInstances[1]);
    expect(googleInstances.map((instance) => instance.credentials?.access_token).sort()).toEqual(['google-user-a', 'google-user-b']);
  });
});
