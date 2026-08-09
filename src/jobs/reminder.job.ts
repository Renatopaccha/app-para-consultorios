// Compatibility module. Reminder delivery is now persisted through the
// notification outbox; importing this file does not start a second scheduler.
export { enqueueDueAppointmentReminders } from './appointment.jobs';
