import { Request, Response } from 'express';
import crypto from 'crypto';
import { AuthRequest } from '../middlewares/auth.middleware';
import prisma from '../prisma';
import { syncAppointmentToCalendar, updateCalendarEventStatus, deleteCalendarEvent } from '../services/calendarSync.service';
import { emailService } from '../services/email.service';
import { canAccessAppointment } from '../services/appointmentAuthorization.service';

export const getAvailableSlots = async (req: Request, res: Response) => {
  try {
    const { doctorId, clinicId, date, serviceId } = req.query;

    if (!doctorId || !clinicId || !date || !serviceId) {
      return res.status(400).json({ error: 'Faltan parámetros requeridos: doctorId, clinicId, date, serviceId' });
    }

    const doctor = await prisma.doctorProfile.findFirst({
      where: { id: String(doctorId), verificationStatus: 'APPROVED' },
      select: { id: true },
    });
    if (!doctor) return res.status(404).json({ error: 'Doctor no disponible' });

    // 1. Obtener la duración del servicio
    const service = await prisma.service.findUnique({
      where: { id: String(serviceId) }
    });

    if (!service) {
      return res.status(404).json({ error: 'Servicio no encontrado' });
    }

    const durationMinutes = service.duration || 30; // 30 minutos por defecto

    // 2. Determinar el día de la semana
    // Convertir string de fecha (YYYY-MM-DD) a objeto Date
    // Se usa T12:00:00Z para evitar problemas de zona horaria y asegurar el día correcto
    const queryDate = new Date(`${date}T12:00:00Z`); 
    const dayOfWeek = queryDate.getUTCDay(); // 0 = Domingo, 1 = Lunes, etc.

    // 3. Buscar los horarios (WorkSchedule) del doctor en esa clínica para el día de la semana
    const schedules = await prisma.workSchedule.findMany({
      where: {
        workplace: {
          doctorProfileId: String(doctorId),
          clinicProfileId: String(clinicId),
          isActive: true
        },
        weekday: dayOfWeek
      }
    });

    if (schedules.length === 0) {
      return res.json([]); // No hay horarios configurados para ese día
    }

    // 4. Buscar citas existentes para ese doctor, clínica y fecha
    // Asumimos que "date" en la base de datos se guarda al inicio del día (00:00:00) o que podemos filtrar por el rango del día
    // Para exactitud, buscaremos convirtiendo la fecha.
    const dateStart = new Date(`${date}T00:00:00.000Z`);
    const dateEnd = new Date(`${date}T23:59:59.999Z`);

    const existingAppointments = await prisma.appointment.findMany({
      where: {
        doctorProfileId: String(doctorId),
        clinicProfileId: String(clinicId),
        date: {
          gte: dateStart,
          lte: dateEnd
        },
        status: {
          in: ['PENDING', 'CONFIRMED'] // Bloquean la agenda
        }
      }
    });

    // 4.5. Filtro de Tiempo Presente (Zona Horaria Ecuador UTC-5)
    const nowUtc = new Date();
    const ecuadorTime = new Date(nowUtc.getTime() - (5 * 60 * 60 * 1000));
    const ecuadorDateString = ecuadorTime.toISOString().split('T')[0];
    
    const isToday = (date === ecuadorDateString);
    const currentMins = isToday ? (ecuadorTime.getUTCHours() * 60 + ecuadorTime.getUTCMinutes()) : 0;

    // 5. Construir los bloques disponibles usando iteración
    const availableSlots: string[] = [];

    // Función auxiliar para convertir "HH:MM" a minutos desde medianoche
    const timeToMinutes = (timeString: string) => {
      const parts = timeString.split(':');
      const hours = Number(parts[0]) || 0;
      const minutes = Number(parts[1]) || 0;
      return hours * 60 + minutes;
    };

    // Función auxiliar para convertir minutos a "HH:MM"
    const minutesToTime = (totalMinutes: number) => {
      const hours = Math.floor(totalMinutes / 60).toString().padStart(2, '0');
      const minutes = (totalMinutes % 60).toString().padStart(2, '0');
      return `${hours}:${minutes}`;
    };

    // Procesar cada bloque de horario configurado para el médico
    for (const schedule of schedules) {
      const startMins = timeToMinutes(schedule.startTime);
      const endMins = timeToMinutes(schedule.endTime);

      // Generar bloques fragmentados por la duración del servicio
      for (let currentSlot = startMins; currentSlot + durationMinutes <= endMins; currentSlot += durationMinutes) {
        const slotStartTime = currentSlot;
        const slotEndTime = currentSlot + durationMinutes;

        // Si es el mismo día y el bloque de inicio ya pasó, lo ignoramos
        if (isToday && slotStartTime <= currentMins) {
          continue;
        }

        // Verificar si existe traslape (overlap) con citas ya agendadas
        const isOverlapping = existingAppointments.some(appt => {
          const apptMinsStart = timeToMinutes(appt.startTime);
          const apptMinsEnd = timeToMinutes(appt.endTime);

          // Condición de traslape:
          // Un slot se traslapa con una cita si: slot_inicio < cita_fin AND slot_fin > cita_inicio
          return (slotStartTime < apptMinsEnd) && (slotEndTime > apptMinsStart);
        });

        if (!isOverlapping) {
          availableSlots.push(minutesToTime(slotStartTime));
        }
      }
    }

    // Ordenar los slots cronológicamente y evitar duplicados si los horarios configurados se traslapan entre sí
    const uniqueSlots = Array.from(new Set(availableSlots)).sort();
    res.json(uniqueSlots);
  } catch (error) {
    console.error('[Booking Controller] Error en getAvailableSlots:', error);
    res.status(500).json({ error: 'Error al obtener horarios disponibles' });
  }
};

export const bookAppointment = async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.user?.id;
    if (!userId) return res.status(401).json({ error: 'No autorizado' });

    const { doctorId, clinicId, serviceId, date, startTime, paymentMethod, isRevision } = req.body;

    if (!doctorId || !clinicId || !serviceId || !date || !startTime || !paymentMethod) {
      return res.status(400).json({ error: 'Faltan parámetros requeridos' });
    }

    // Paso A: Obtener datos base
    const [service, patient, doctor] = await Promise.all([
      prisma.service.findUnique({ where: { id: serviceId } }),
      prisma.user.findUnique({ where: { id: userId } }),
      prisma.doctorProfile.findUnique({ where: { id: doctorId }, include: { user: true } })
    ]);

    if (!service) return res.status(404).json({ error: 'Servicio no encontrado' });
    if (!patient) return res.status(404).json({ error: 'Paciente no encontrado' });
    if (!doctor || !doctor.user) return res.status(404).json({ error: 'Doctor no encontrado' });
    if (doctor.verificationStatus !== 'APPROVED') return res.status(404).json({ error: 'Doctor no disponible' });

    const durationMinutes = service.duration || 30;
    const price = service.price || 0;

    const timeToMinutes = (timeString: string) => {
      const parts = timeString.split(':');
      const hours = Number(parts[0]) || 0;
      const minutes = Number(parts[1]) || 0;
      return hours * 60 + minutes;
    };

    const minutesToTime = (totalMinutes: number) => {
      const hours = Math.floor(totalMinutes / 60).toString().padStart(2, '0');
      const minutes = (totalMinutes % 60).toString().padStart(2, '0');
      return `${hours}:${minutes}`;
    };

    const startMins = timeToMinutes(startTime);
    const endTime = minutesToTime(startMins + durationMinutes);

    // Paso B: Validación de solapamiento
    const dateStart = new Date(`${date}T00:00:00.000Z`);
    const dateEnd = new Date(`${date}T23:59:59.999Z`);

    const existingAppointments = await prisma.appointment.findMany({
      where: {
        doctorProfileId: doctorId,
        clinicProfileId: clinicId,
        date: { gte: dateStart, lte: dateEnd },
        status: { in: ['PENDING', 'CONFIRMED'] }
      }
    });

    const isOverlapping = existingAppointments.some(appt => {
      const apptMinsStart = timeToMinutes(appt.startTime);
      const apptMinsEnd = timeToMinutes(appt.endTime);
      return (startMins < apptMinsEnd) && ((startMins + durationMinutes) > apptMinsStart);
    });

    if (isOverlapping) {
      return res.status(409).json({ error: 'El horario seleccionado ya no está disponible.' });
    }

    // Paso C: Lógica de Negocio
    let finalPaymentMethod = paymentMethod;
    let finalPaymentStatus = 'PENDING';
    let finalStatus = 'PENDING'; // Mapeamos 'PENDING_CONFIRMATION' a 'PENDING'
    let verificationCode: string | null = null;

    if (isRevision === true || price === 0) {
      finalPaymentMethod = 'NONE';
      finalPaymentStatus = 'PAID';
      finalStatus = 'CONFIRMED';
      verificationCode = null;
    } else if (paymentMethod === 'CARD') {
      finalPaymentStatus = 'PAID';
      finalStatus = 'CONFIRMED'; // Simulamos éxito por ahora
    } else if (paymentMethod === 'CASH') {
      finalPaymentStatus = 'PENDING';
      finalStatus = 'PENDING';
      verificationCode = crypto.randomBytes(3).toString('hex').toUpperCase();
    }

    // Paso D: Asignación Cronológica de Turnos
    const appointmentDate = new Date(`${date}T12:00:00Z`);

    // Obtenemos todas las citas del día para este doctor, ordenadas cronológicamente
    const existingAppointmentsTurn = await prisma.appointment.findMany({
      where: {
        doctorProfileId: doctorId,
        date: appointmentDate,
        status: { not: 'CANCELLED' }
      },
      orderBy: { startTime: 'asc' }
    });

    let turnNumber = 1;
    for (const appt of existingAppointmentsTurn) {
      if (timeToMinutes(startTime) >= timeToMinutes(appt.startTime)) {
        turnNumber++;
      }
    }

    // Desplazamos el turno +1 para todas las citas posteriores
    await prisma.appointment.updateMany({
      where: {
        doctorProfileId: doctorId,
        date: appointmentDate,
        startTime: { gte: startTime },
        status: { not: 'CANCELLED' },
        turnNumber: { not: null }
      },
      data: {
        turnNumber: { increment: 1 }
      }
    });

    // Paso E: Crear Cita

    const appointment = await prisma.appointment.create({
      data: {
        patientId: userId,
        doctorProfileId: doctorId,
        clinicProfileId: clinicId,
        serviceId: serviceId,
        date: appointmentDate,
        startTime,
        endTime,
        status: finalStatus as any,
        paymentMethod: finalPaymentMethod,
        paymentStatus: finalPaymentStatus as any,
        verificationCode,
        turnNumber
      }
    });

    // Inyectamos el evento al calendario al momento de crear la reserva
    syncAppointmentToCalendar(appointment.id).catch(console.error);

    // Correos Transaccionales Asíncronos
    const patientName = patient.firstName || 'Paciente';
    const doctorName = doctor.user.lastName ? `Dr/Dra. ${doctor.user.lastName}` : 'Especialista';
    const formattedDate = appointmentDate.toISOString().split('T')[0] || '';

    // A) Correo al Paciente
    emailService.sendAppointmentConfirmation(
      patient.email,
      patientName,
      doctorName,
      formattedDate,
      startTime,
      turnNumber,
      paymentMethod === 'CASH',
      verificationCode
    ).catch(console.error);

    // B) Correo al Doctor
    emailService.sendDoctorNewBooking(
      doctor.user.email,
      doctorName,
      patientName,
      formattedDate,
      startTime,
      service.name
    ).catch(console.error);

    res.status(201).json(appointment);

  } catch (error) {
    console.error('[Booking Controller] Error en bookAppointment:', error);
    res.status(500).json({ error: 'Error al agendar la cita' });
  }
};

export const verifyCashPayment = async (req: AuthRequest, res: Response) => {
  try {
    const { verificationCode } = req.body;

    if (!verificationCode) {
      return res.status(400).json({ error: 'El código de verificación es requerido' });
    }

    const appointment = await prisma.appointment.findUnique({
      where: { verificationCode }
    });

    if (!appointment) {
      return res.status(404).json({ error: 'Código inválido o no encontrado' });
    }

    const userId = req.user?.id;
    const role = req.user?.role;
    if (!userId || !role || !(await canAccessAppointment(userId, role, appointment))) {
      return res.status(403).json({ error: 'No tienes permisos para verificar el pago de esta cita' });
    }

    if (appointment.paymentMethod !== 'CASH') {
      return res.status(400).json({ error: 'Esta cita no está configurada para pago en efectivo' });
    }

    if (appointment.paymentStatus === 'PAID') {
      return res.status(400).json({ error: 'Esta cita ya fue pagada' });
    }

    const updatedAppointment = await prisma.appointment.update({
      where: { id: appointment.id },
      data: {
        paymentStatus: 'PAID',
        verificationCode: null // Invalidamos el código por seguridad extrema
      }
    });

    // Actualizamos el evento en el calendario para quitar el tag de "Pago Pendiente"
    updateCalendarEventStatus(updatedAppointment.id).catch(console.error);

    res.status(200).json({
      message: 'Pago confirmado exitosamente. La cita ha sido asegurada.',
      appointment: updatedAppointment
    });

  } catch (error) {
    console.error('[Booking Controller] Error en verifyCashPayment:', error);
    res.status(500).json({ error: 'Error al verificar el pago' });
  }
};

export const cancelAppointmentByPatient = async (req: AuthRequest, res: Response) => {
  try {
    const appointmentId = req.params.id as string;
    const { cancellationReason } = req.body;
    const userId = req.user?.id;

    if (!userId) {
      return res.status(401).json({ error: 'No autorizado' });
    }

    const appointment = await prisma.appointment.findUnique({
      where: { id: appointmentId }
    });

    if (!appointment) {
      return res.status(404).json({ error: 'Cita no encontrada' });
    }

    const role = req.user?.role;
    if (!role || !(await canAccessAppointment(userId, role, appointment))) {
      return res.status(403).json({ error: 'No tienes permisos para cancelar esta cita' });
    }

    if (appointment.status === 'CANCELLED') {
      return res.status(400).json({ error: 'Esta cita ya ha sido cancelada previamente' });
    }

    const updatedAppointment = await prisma.appointment.update({
      where: { id: appointmentId },
      data: {
        status: 'CANCELLED',
        cancellationReason: cancellationReason || null
      }
    });

    // Eliminamos el evento del calendario para liberar la agenda
    deleteCalendarEvent(appointmentId).catch(console.error);

    res.status(200).json({
      message: 'Cita cancelada exitosamente',
      appointment: updatedAppointment
    });

  } catch (error) {
    console.error('[Booking Controller] Error en cancelAppointmentByPatient:', error);
    res.status(500).json({ error: 'Error al cancelar la cita' });
  }
};

export const confirmPatientAttendance = async (req: AuthRequest, res: Response) => {
  try {
    const appointmentId = req.params.id as string;
    const userId = req.user?.id;

    if (!userId) {
      return res.status(401).json({ error: 'No autorizado' });
    }

    const appointment = await prisma.appointment.findUnique({
      where: { id: appointmentId }
    });

    if (!appointment) {
      return res.status(404).json({ error: 'Cita no encontrada' });
    }

    const role = req.user?.role;
    if (!role || !(await canAccessAppointment(userId, role, appointment))) {
      return res.status(403).json({ error: 'No tienes permisos para confirmar esta cita' });
    }

    const updatedAppointment = await prisma.appointment.update({
      where: { id: appointmentId },
      data: { isPatientConfirmed: true, status: 'CONFIRMED' }
    });

    // Actualizamos el evento en el calendario externo de forma asíncrona
    updateCalendarEventStatus(appointmentId).catch(console.error);

    res.status(200).json({
      message: 'Asistencia confirmada exitosamente',
      appointment: updatedAppointment
    });

  } catch (error) {
    console.error('[Booking Controller] Error en confirmPatientAttendance:', error);
    res.status(500).json({ error: 'Error al confirmar asistencia' });
  }
};

export const getAppointments = async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.user?.id;
    if (!userId) return res.status(401).json({ error: 'No autorizado' });

    const doctor = await prisma.doctorProfile.findUnique({ where: { userId } });
    if (!doctor) return res.status(403).json({ error: 'Acceso exclusivo para doctores' });

    const appointments = await prisma.appointment.findMany({
      where: { doctorProfileId: doctor.id },
      include: {
        patient: { select: { id: true, firstName: true, lastName: true } }
      }
    });

    const formattedAppointments = appointments.map(app => {
      const formattedDate = app.startDatetime 
        ? app.startDatetime.toISOString()
        : null;

      return {
        ...app,
        patientId: app.patient.id,
        startDatetime: formattedDate,
      };
    });

    return res.json(formattedAppointments);
  } catch (error) {
    console.error(error);
    return res.status(500).json({ error: 'Error al obtener citas' });
  }
};

export const getAppointmentById = async (req: AuthRequest, res: Response) => {
  try {
    const { id } = req.params;
    const appointment = await prisma.appointment.findUnique({ 
      where: { id: id as string },
      include: {
        patient: { select: { firstName: true, lastName: true, email: true } },
        doctorProfile: { include: { user: { select: { firstName: true, lastName: true } } } },
        clinicProfile: { select: { name: true, address: true } }
      }
    });
    if (!appointment) {
      return res.status(404).json({ error: 'Cita no encontrada' });
    }
    const userId = req.user?.id;
    const role = req.user?.role;
    if (!userId || !role || !(await canAccessAppointment(userId, role, appointment))) {
      return res.status(403).json({ error: 'No tienes permisos para ver esta cita' });
    }
    res.json(appointment);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Error al obtener cita' });
  }
};

export const updateBookingStatus = async (req: AuthRequest, res: Response) => {
  try {
    const { id } = req.params;
    const { status } = req.body;
    const userId = req.user?.id;
    const userRole = req.user?.role;

    if (!status) {
      return res.status(400).json({ error: 'El estado (status) es requerido' });
    }

    const validStatuses = ['PENDING', 'CONFIRMED', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED', 'MISSED'];
    if (!validStatuses.includes(status)) {
      return res.status(400).json({ error: 'Estado no válido. Opciones permitidas: ' + validStatuses.join(', ') });
    }

    const appointment = await prisma.appointment.findUnique({
      where: { id: id as string }
    });

    if (!appointment) {
      return res.status(404).json({ error: 'Cita no encontrada' });
    }

    if (!userId || !userRole || !(await canAccessAppointment(userId, userRole, appointment))) {
      return res.status(403).json({ error: 'No tienes permisos para modificar el estado de esta cita' });
    }

    const updatedAppointment = await prisma.appointment.update({
      where: { id: id as string },
      data: { status }
    });

    res.json({ message: 'Estado actualizado correctamente', appointment: updatedAppointment });
  } catch (error) {
    console.error('[Booking Controller] Error en updateBookingStatus:', error);
    res.status(500).json({ error: 'Error al actualizar el estado de la cita' });
  }
};
