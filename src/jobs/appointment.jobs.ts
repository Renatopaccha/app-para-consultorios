import cron from 'node-cron';
import prisma from '../prisma';
import { emailService } from '../services/email.service';
import { expirePendingConfirmations } from '../services/appointmentConfirmation.service';

export const startCronJobs = () => {
  console.log('[Cron Jobs] Inicializando el vigilante de citas...');

  // Job 1 (Recordatorio 24h): Se ejecuta al minuto 0 de cada hora
  cron.schedule('0 * * * *', async () => {
    try {
      console.log('[Cron Job 1] Buscando citas para enviar recordatorios de 24h...');
      
      const now = new Date();
      // Ventana: desde 24 horas a 25 horas en el futuro
      const startWindow = new Date(now.getTime() + 24 * 60 * 60 * 1000);
      const endWindow = new Date(now.getTime() + 25 * 60 * 60 * 1000);

      const appointments = await prisma.appointment.findMany({
        where: {
          date: {
            gte: startWindow,
            lt: endWindow
          },
          status: { in: ['PENDING', 'CONFIRMED'] },
          reminder24hSent: false
        },
        include: {
          patient: true,
          patientInvitation: { select: { email: true } },
          doctorProfile: {
            include: { user: true }
          }
        }
      });

      for (const appt of appointments) {
        const patientEmail = appt.patient?.email || appt.patientInvitation?.email;
        if (!patientEmail) continue;
        const doctorName = `${appt.doctorProfile.user.firstName} ${appt.doctorProfile.user.lastName}`;
        const dateStr = appt.date.toISOString().split('T')[0] || '';

        if (appt.paymentMethod === 'CARD' || appt.paymentMethod === 'NONE') {
          await emailService.sendCardReminderEmail(patientEmail, doctorName, dateStr, appt.startTime);
        } else if (appt.paymentMethod === 'CASH' && appt.status === 'PENDING') {
          await emailService.sendCashConfirmationPromptEmail(patientEmail, doctorName, dateStr, appt.startTime);
        }

        // Marcar como enviado para no repetir
        await prisma.appointment.update({
          where: { id: appt.id },
          data: { reminder24hSent: true }
        });
      }
    } catch (error) {
      console.error('[Cron Job 1] Error ejecutando recordatorio 24h:', error);
    }
  });

  // Job 2: compatibility scheduler. Confirmation deadline is canonical; payment never cancels a booking.
  cron.schedule('0 * * * *', async () => {
    try {
      const expired = await expirePendingConfirmations(new Date());
      if (expired) console.log(`[Cron Job 2] ${expired} cita(s) expirada(s) por falta de confirmación.`);
    } catch (error) {
      console.error('[Cron Job 2] Error ejecutando cancelador de 12h:', error);
    }
  });
};
