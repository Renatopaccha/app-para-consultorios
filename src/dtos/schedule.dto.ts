export type ScheduleBlockTypeInput = 'BLOCK' | 'PERSONAL';
export type ScheduleBlockVisibilityInput = 'PRIVATE' | 'PUBLIC_LABEL';
export type OperationalBlockPublicLabel = 'LUNCH' | 'VACATION' | 'PROFESSIONAL_DUTY' | 'MAINTENANCE';

export interface DoctorWorkScheduleInput {
  weekday: number;
  startTime: string;
  endTime: string;
}

export interface SaveDoctorWorkSchedulesInput {
  clinicId: string;
  schedules: DoctorWorkScheduleInput[];
}

export interface CreateDoctorAppointmentInput {
  /** @deprecated use patient.id */
  patientId?: string;
  patient?: {
    id?: string;
    email?: string;
    firstName?: string;
    lastName?: string;
    phone?: string | null;
  };
  clinicId: string;
  serviceId: string;
  startsAt: string;
  sendEmail: boolean;
}

export type ValidatedInvitedPatient = {
  email: string;
  firstName: string;
  lastName: string;
  phone: string | null;
};

export type ValidatedDoctorAppointmentPatient =
  | { kind: 'registered'; id: string }
  | { kind: 'invited'; patient: ValidatedInvitedPatient };

export type ValidatedCreateDoctorAppointment = {
  clinicId: string;
  serviceId: string;
  startsAt: string;
  sendEmail: boolean;
  patient: ValidatedDoctorAppointmentPatient;
};

export type ManualAppointmentValidation =
  | { success: true; data: ValidatedCreateDoctorAppointment }
  | { success: false; fields: Record<string, string> };

const EMAIL_PATTERN = /^\S+@\S+\.\S+$/;

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function requiredString(value: unknown, field: string, fields: Record<string, string>, max = 255): string | undefined {
  if (typeof value !== 'string') {
    fields[field] = 'Este campo debe ser texto.';
    return undefined;
  }
  const normalized = value.trim();
  if (!normalized) {
    fields[field] = 'Este campo es obligatorio.';
    return undefined;
  }
  if (normalized.length > max) {
    fields[field] = `Este campo no puede superar ${max} caracteres.`;
    return undefined;
  }
  return normalized;
}

/** Parses external JSON into a trusted invited-patient DTO. */
export function parseInvitedPatient(value: unknown): { success: true; data: ValidatedInvitedPatient } | { success: false; fields: Record<string, string> } {
  const fields: Record<string, string> = {};
  if (!isPlainObject(value)) return { success: false, fields: { patient: 'Ingresa los datos del paciente.' } };
  const emailInput = requiredString(value.email, 'patient.email', fields, 254);
  const firstName = requiredString(value.firstName, 'patient.firstName', fields, 100);
  const lastName = requiredString(value.lastName, 'patient.lastName', fields, 100);
  const email = emailInput?.toLowerCase();
  if (email && !EMAIL_PATTERN.test(email)) fields['patient.email'] = 'El correo no es válido.';

  let phone: string | null = null;
  if (value.phone !== undefined && value.phone !== null) {
    if (typeof value.phone !== 'string') fields['patient.phone'] = 'El teléfono debe ser texto o nulo.';
    else {
      const normalizedPhone = value.phone.trim();
      if (normalizedPhone) {
        if (normalizedPhone.length < 5 || normalizedPhone.length > 30) fields['patient.phone'] = 'El teléfono debe tener entre 5 y 30 caracteres.';
        else phone = normalizedPhone;
      }
    }
  }
  if (Object.keys(fields).length || !email || !firstName || !lastName) return { success: false, fields };
  return { success: true, data: { email, firstName, lastName, phone } };
}

/** Parses the complete manual-doctor appointment payload before any DB work. */
export function parseCreateDoctorAppointment(value: unknown): ManualAppointmentValidation {
  const fields: Record<string, string> = {};
  if (!isPlainObject(value)) return { success: false, fields: { body: 'El cuerpo de la solicitud no es válido.' } };
  const clinicId = requiredString(value.clinicId, 'clinicId', fields);
  const serviceId = requiredString(value.serviceId, 'serviceId', fields);
  const startsAt = requiredString(value.startsAt, 'startsAt', fields);
  const sendEmail = value.sendEmail === undefined ? false : value.sendEmail;
  if (typeof sendEmail !== 'boolean') fields.sendEmail = 'Debe ser verdadero o falso.';

  let patient: ValidatedDoctorAppointmentPatient | undefined;
  const legacyPatientId = value.patientId;
  if (isPlainObject(value.patient) && typeof value.patient.id === 'string' && value.patient.id.trim()) {
    patient = { kind: 'registered', id: value.patient.id.trim() };
  } else if (!value.patient && typeof legacyPatientId === 'string' && legacyPatientId.trim()) {
    patient = { kind: 'registered', id: legacyPatientId.trim() };
  } else {
    const invited = parseInvitedPatient(value.patient);
    if (invited.success) patient = { kind: 'invited', patient: invited.data };
    else Object.assign(fields, invited.fields);
  }
  if (Object.keys(fields).length || !clinicId || !serviceId || !startsAt || !patient || typeof sendEmail !== 'boolean') return { success: false, fields };
  return { success: true, data: { clinicId, serviceId, startsAt, sendEmail, patient } };
}

export interface CreateScheduleBlockInput {
  doctorId?: string;
  clinicId?: string | null;
  startsAt: string;
  endsAt: string;
  type: ScheduleBlockTypeInput;
  visibility?: ScheduleBlockVisibilityInput;
  publicLabel?: OperationalBlockPublicLabel | null;
  privateTitle?: string | null;
  internalNotes?: string | null;
  /** @deprecated Use privateTitle. Retained for older clients. */
  reason?: string | null;
}

export interface UpdateScheduleBlockInput {
  clinicId?: string | null;
  startsAt?: string;
  endsAt?: string;
  type?: ScheduleBlockTypeInput;
  visibility?: ScheduleBlockVisibilityInput;
  publicLabel?: OperationalBlockPublicLabel | null;
  privateTitle?: string | null;
  internalNotes?: string | null;
  reason?: string | null;
  expectedUpdatedAt?: string;
}
