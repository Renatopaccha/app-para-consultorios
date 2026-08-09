import cron from 'node-cron';
import prisma from '../prisma';
import { expirePendingConfirmations } from '../services/appointmentConfirmation.service';
import { enqueueNotification } from '../services/notificationOutbox.service';

export async function enqueueDueAppointmentReminders(now = new Date()): Promise<number> {
  let queued = 0;
  const windows = [
    { kind: '24H' as const, fromHours: 23, toHours: 25, flag: 'reminder24hSent' as const },
    { kind: '2H' as const, fromHours: 1.75, toHours: 2.25, flag: 'reminder2hSent' as const },
    { kind: '1H' as const, fromHours: .75, toHours: 1.25, flag: 'reminder1hSent' as const },
  ];
  for (const window of windows) {
    const appointments = await prisma.appointment.findMany({ where: { startsAt: { gte: new Date(now.getTime() + window.fromHours * 60 * 60_000), lt: new Date(now.getTime() + window.toHours * 60 * 60_000) }, status: { in: ['PENDING', 'CONFIRMED'] }, [window.flag]: false } });
    for (const appointment of appointments) {
      const created = await prisma.$transaction(async tx => {
        const changed = await tx.appointment.updateMany({ where: { id: appointment.id, status: { in: ['PENDING', 'CONFIRMED'] }, startsAt: appointment.startsAt, [window.flag]: false }, data: { [window.flag]: true } });
        if (changed.count !== 1) return false;
        await enqueueNotification(tx, { eventType: 'APPOINTMENT_REMINDER', aggregateId: appointment.id, deduplicationKey: `appointment:${appointment.id}:reminder-${window.kind.toLowerCase()}:${appointment.startsAt?.toISOString()}`, payload: { reminderKind: window.kind, newStartsAt: appointment.startsAt?.toISOString() } });
        return true;
      });
      if (created) queued++;
    }
  }
  return queued;
}

export const startCronJobs = () => {
  console.log('[Cron Jobs] Inicializando jobs persistentes de citas...');
  cron.schedule('0 * * * *', () => { enqueueDueAppointmentReminders().catch(error => console.error(JSON.stringify({ event: 'appointment_reminder_enqueue_failed', error: error instanceof Error ? error.name : 'UnknownError' }))); });
  cron.schedule('0 * * * *', () => { expirePendingConfirmations(new Date()).catch(error => console.error(JSON.stringify({ event: 'appointment_expiration_failed', error: error instanceof Error ? error.name : 'UnknownError' }))); });
};
