import cron from 'node-cron';
import prisma from '../prisma';
import { notificationService } from '../services/notification.service';

const logTimestamp = () => new Date().toISOString();

/**
 * Calcula la diferencia en horas entre dos fechas.
 */
const diffInHours = (date1: Date, date2: Date) => {
  return (date1.getTime() - date2.getTime()) / 36e5;
};

// Se ejecuta cada minuto (* * * * *)
cron.schedule('* * * * *', async () => {
  try {
    const now = new Date();
    
    // Obtenemos solo citas pendientes
    const upcomingAppointments = await prisma.appointment.findMany({
      where: {
        status: 'PENDING',
        date: {
          // Filtrar desde ayer para asegurar que si es a primera hora de hoy aún funcione bien con la franja horaria
          gte: new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1), 
        },
        OR: [
          { reminder24hSent: false },
          { reminder2hSent: false },
          { reminder1hSent: false }
        ]
      },
      include: {
        patient: true,
        doctorProfile: {
          include: { user: true }
        },
        clinicProfile: true
      }
    });

    for (const appointment of upcomingAppointments) {
      // Reconstruimos la fecha/hora exacta de la cita
      const parts = appointment.startTime.split(':');
      const hours = Number(parts[0]) || 0;
      const minutes = Number(parts[1]) || 0;
      const exactAppointmentDate = new Date(appointment.date);
      exactAppointmentDate.setHours(hours, minutes, 0, 0);

      const hoursUntilAppointment = diffInHours(exactAppointmentDate, now);
      
      // Ignoramos citas que ya pasaron
      if (hoursUntilAppointment < 0) continue;

      let shouldUpdate = false;
      const updates: any = {};
      let reminderTitle = '';
      let reminderBody = '';

      // Ventana de tolerancia: ~3 minutos (para evitar omitir por micro-retrasos en cron, pero asegurando no mandar doble)
      if (!appointment.reminder24hSent && hoursUntilAppointment <= 24.05 && hoursUntilAppointment >= 23.95) {
        reminderTitle = 'Recordatorio de Cita Médica 🩺';
        reminderBody = `Hola ${appointment.patient.firstName}, tu cita con el Dr. ${appointment.doctorProfile.user?.lastName} es mañana a las ${appointment.startTime}. Tienes el Turno #${appointment.turnNumber}. ¡Te esperamos en ${appointment.clinicProfile.name}!`;
        updates.reminder24hSent = true;
        shouldUpdate = true;
      } 
      else if (!appointment.reminder2hSent && hoursUntilAppointment <= 2.05 && hoursUntilAppointment >= 1.95) {
        reminderTitle = 'Tu cita es en 2 horas ⏰';
        reminderBody = `Hola ${appointment.patient.firstName}, recuerda que tu cita con el Dr. ${appointment.doctorProfile.user?.lastName} empieza en 2 horas a las ${appointment.startTime}. Turno #${appointment.turnNumber}. ¡Llega con anticipación!`;
        updates.reminder2hSent = true;
        shouldUpdate = true;
      } 
      else if (!appointment.reminder1hSent && hoursUntilAppointment <= 1.05 && hoursUntilAppointment >= 0.95) {
        reminderTitle = '¡Tu cita es en 1 hora! ⏳';
        reminderBody = `Hola ${appointment.patient.firstName}, prepárate. Tu cita (Turno #${appointment.turnNumber}) con el Dr. ${appointment.doctorProfile.user?.lastName} es a las ${appointment.startTime}. ¡Te esperamos!`;
        updates.reminder1hSent = true;
        shouldUpdate = true;
      }

      if (shouldUpdate) {
        // Enviar Email al paciente
        const emailHtml = `
          <h3>${reminderTitle}</h3>
          <p>Hola ${appointment.patient.firstName},</p>
          <p>${reminderBody}</p>
          <p>Te esperamos.</p>
        `;
        // Fire and forget - si falla no bloquea la bd (idealmente usaríamos una queue, pero esto sirve para la Fase 2)
        notificationService.sendEmail(appointment.patient.email, 'Recordatorio de Cita - Vitali', emailHtml).catch(console.error);

        // Enviar Push (si tiene token guardado en la app móvil)
        if (appointment.patient.fcmToken) {
          notificationService.sendPushNotification(appointment.patient.fcmToken, reminderTitle, reminderBody).catch(console.error);
        }

        // Marcar la cita para no volver a enviar este recordatorio exacto
        await prisma.appointment.update({
          where: { id: appointment.id },
          data: updates
        });
        
        console.log(`[ReminderJob ${logTimestamp()}] Recordatorio enviado para cita ${appointment.id}`);
      }
    }
  } catch (error) {
    console.error(`[ReminderJob ${logTimestamp()}] Error ejecutando cron:`, error);
  }
});
