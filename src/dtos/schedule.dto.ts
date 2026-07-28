export type ScheduleBlockTypeInput = 'BLOCK' | 'PERSONAL';

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

export interface CreateScheduleBlockInput {
  doctorId?: string;
  clinicId?: string | null;
  startsAt: string;
  endsAt: string;
  type: ScheduleBlockTypeInput;
  reason?: string | null;
}
