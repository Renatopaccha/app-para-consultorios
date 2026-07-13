import { Request, Response } from 'express';
import { AuthRequest } from '../middlewares/auth.middleware';
import prisma from '../prisma';
import { BookingError, cancelAppointment, createAppointment } from '../services/appointmentBooking.service';
import { syncAppointmentToCalendar, updateCalendarEventStatus, deleteCalendarEvent } from '../services/calendarSync.service';
import { canAccessAppointment } from '../services/appointmentAuthorization.service';
import { getAppointmentCalendarPresentation } from '../services/appointmentCalendarPresentation.service';
import { confirmPatientAppointment } from '../services/appointmentConfirmation.service';
import { completeAppointment, markAppointmentNoShow, startAppointment } from '../services/appointmentLifecycle.service';
import { confirmLegacyCashPayment } from '../services/legacyCashPayment.service';

const legacyActor = (req: AuthRequest) => ({ id: req.user!.id, role: req.user!.role });
function deprecated(res: Response, canonicalRoute: string) { res.setHeader('Deprecation', 'true'); res.setHeader('Link', `<${canonicalRoute}>; rel="successor-version"`); }
function domainError(error: unknown, res: Response) { if (error instanceof BookingError) return res.status(error.status).json({ error: error.code, message: error.message }); console.error('[Booking Controller]', error); return res.status(500).json({ error: 'INTERNAL_ERROR' }); }

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
    if (!req.user) return res.status(401).json({ error: 'UNAUTHORIZED' });
    deprecated(res, '/api/bookings/book');
    const { doctorId, clinicId, serviceId, startsAt, date, startTime, paymentMethod } = req.body;
    const requestedStart = startsAt || (date && startTime ? `${date}T${startTime}` : undefined);
    const appointment = await createAppointment({ patientUserId: req.user.id, doctorId, clinicId, serviceId, requestedStart, paymentMethod });
    syncAppointmentToCalendar(appointment.id).catch(console.error);
    return res.status(201).json(appointment);

  } catch (error) {
    return domainError(error, res);
  }
};

export const verifyCashPayment = async (req: AuthRequest, res: Response) => {
  try {
    const { verificationCode } = req.body;
    if (!req.user) return res.status(401).json({ error: 'UNAUTHORIZED' });
    if (typeof verificationCode !== 'string' || !verificationCode) return res.status(400).json({ error: 'VERIFICATION_CODE_REQUIRED' });
    deprecated(res, '/api/payments/cash (pending Payment module)');
    const updatedAppointment = await confirmLegacyCashPayment(verificationCode, legacyActor(req));

    // Actualizamos el evento en el calendario para quitar el tag de "Pago Pendiente"
    updateCalendarEventStatus(updatedAppointment.id).catch(console.error);

    res.status(200).json({
      message: 'Pago confirmado exitosamente. La cita ha sido asegurada.',
      appointment: updatedAppointment
    });

  } catch (error) {
    return domainError(error, res);
  }
};

export const cancelAppointmentByPatient = async (req: AuthRequest, res: Response) => {
  try {
    const appointmentId = req.params.id as string;
    const { cancellationReason } = req.body;
    if (!req.user) return res.status(401).json({ error: 'UNAUTHORIZED' });
    deprecated(res, '/api/bookings/:id/cancel');
    const updatedAppointment = await cancelAppointment(appointmentId, req.user.id, typeof cancellationReason === 'string' ? cancellationReason : undefined);

    // Eliminamos el evento del calendario para liberar la agenda
    deleteCalendarEvent(appointmentId).catch(console.error);

    res.status(200).json({
      message: 'Cita cancelada exitosamente',
      appointment: updatedAppointment
    });

  } catch (error) {
    return domainError(error, res);
  }
};

export const confirmPatientAttendance = async (req: AuthRequest, res: Response) => {
  try {
    const appointmentId = req.params.id as string;
    if (!req.user) return res.status(401).json({ error: 'UNAUTHORIZED' });
    deprecated(res, '/api/bookings/:id/confirm');
    const updatedAppointment = await confirmPatientAppointment(appointmentId, req.user.id);

    // Actualizamos el evento en el calendario externo de forma asíncrona
    updateCalendarEventStatus(appointmentId).catch(console.error);

    res.status(200).json({
      message: 'Asistencia confirmada exitosamente',
      appointment: updatedAppointment
    });

  } catch (error) {
    return domainError(error, res);
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
        patient: { select: { id: true, firstName: true, lastName: true } },
        turn: true
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
        appointmentStatus: app.status,
        ...getAppointmentCalendarPresentation({ ...app, turnStatus: app.turn?.status }),
        turnStatus: app.turn?.status || null,
        turnNumber: app.turn?.turnNumber || null,
        queueOrder: app.turn?.queueOrder || null,
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
    if (!req.user) return res.status(401).json({ error: 'UNAUTHORIZED' });
    deprecated(res, 'Use /cancel, /start, /complete or /no-show according to the transition');
    let appointment;
    if (status === 'IN_PROGRESS') appointment = await startAppointment(String(id), legacyActor(req));
    else if (status === 'COMPLETED') appointment = await completeAppointment(String(id), legacyActor(req));
    else if (status === 'MISSED') appointment = await markAppointmentNoShow(String(id), legacyActor(req));
    else if (status === 'CANCELLED') appointment = await cancelAppointment(String(id), req.user.id, typeof req.body.reason === 'string' ? req.body.reason : undefined);
    else return res.status(422).json({ error: 'LEGACY_STATUS_TRANSITION_NOT_SUPPORTED', message: 'Usa la ruta canónica de confirmación, cancelación o ciclo operativo.' });
    return res.json({ message: 'Estado actualizado correctamente', appointment });
  } catch (error) {
    return domainError(error, res);
  }
};
