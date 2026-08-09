export type AppointmentNotificationTemplateInput = {
  patientFirstName: string; doctorName: string; clinicName: string;
  startsAt: Date; previousStartsAt?: Date; patientMessage?: string | null;
};

export type NotificationTemplate = { title: string; message: string; html: string };
const date = (value: Date) => new Intl.DateTimeFormat('es-EC', { timeZone: 'America/Guayaquil', dateStyle: 'full', timeStyle: 'short' }).format(value);
const escape = (value: string) => value.replace(/[&<>'"]/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[char] ?? char));
const html = (title: string, greeting: string, message: string) => `<h2>${escape(title)}</h2><p>Hola ${escape(greeting)},</p><p>${escape(message)}</p>`;

export function appointmentCreatedTemplate(input: AppointmentNotificationTemplateInput): NotificationTemplate {
  const message = `Tu cita con ${input.doctorName} en ${input.clinicName} fue agendada para ${date(input.startsAt)}.`;
  return { title: 'Cita agendada', message, html: html('Cita agendada', input.patientFirstName, message) };
}
export function appointmentCancelledTemplate(input: AppointmentNotificationTemplateInput): NotificationTemplate {
  const suffix = input.patientMessage?.trim() ? ` ${input.patientMessage.trim()}` : '';
  const message = `Tu cita con ${input.doctorName} en ${input.clinicName} del ${date(input.startsAt)} fue cancelada.${suffix}`;
  return { title: 'Cita cancelada', message, html: html('Cita cancelada', input.patientFirstName, message) };
}
export function appointmentRescheduledTemplate(input: AppointmentNotificationTemplateInput): NotificationTemplate {
  const previous = input.previousStartsAt ? `, antes prevista para ${date(input.previousStartsAt)}` : '';
  const suffix = input.patientMessage?.trim() ? ` ${input.patientMessage.trim()}` : '';
  const message = `Tu cita con ${input.doctorName} en ${input.clinicName}${previous} fue reprogramada para ${date(input.startsAt)}.${suffix}`;
  return { title: 'Cita reprogramada', message, html: html('Cita reprogramada', input.patientFirstName, message) };
}
export function appointmentReminderTemplate(input: AppointmentNotificationTemplateInput): NotificationTemplate {
  const message = `Recuerda tu cita con ${input.doctorName} en ${input.clinicName} el ${date(input.startsAt)}.`;
  return { title: 'Recordatorio de cita', message, html: html('Recordatorio de cita', input.patientFirstName, message) };
}
export function patientInvitationTemplate(input: AppointmentNotificationTemplateInput, registerUrl: string): NotificationTemplate {
  const message = `Tienes una cita con ${input.doctorName} en ${input.clinicName} para ${date(input.startsAt)}. Crea tu cuenta para gestionarla.`;
  return { title: 'Tienes una cita en Zenda', message, html: `${html('Tienes una cita en Zenda', input.patientFirstName, message)}<p><a href="${escape(registerUrl)}">Crear cuenta</a></p>` };
}
