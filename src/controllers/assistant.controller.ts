import { Response } from 'express';
import { AuthRequest } from '../middlewares/auth.middleware';
import prisma from '../prisma';
import { deleteCalendarEvent } from '../services/calendarSync.service';
import { BookingError } from '../services/appointmentBooking.service';
import { completeAppointment, markAppointmentNoShow, postponeAppointmentTurn, startAppointment } from '../services/appointmentLifecycle.service';

const legacyActor = (req: AuthRequest) => ({ id: req.user!.id, role: req.user!.role });
const legacyError = (error: unknown, res: Response) => {
  if (error instanceof BookingError) return res.status(error.status).json({ error: error.code, message: error.message });
  console.error('[Assistant Controller] Error en ruta heredada:', error);
  return res.status(500).json({ error: 'INTERNAL_ERROR' });
};

function markDeprecated(res: Response, canonicalRoute: string) {
  res.setHeader('Deprecation', 'true');
  res.setHeader('Link', `<${canonicalRoute}>; rel="successor-version"`);
}

export const getAssistantDashboard = async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.user?.id;
    const role = req.user?.role;

    if (!userId || role !== 'ASSISTANT') {
      return res.status(401).json({ error: 'No autorizado' });
    }

    const assistant = await prisma.assistantProfile.findUnique({
      where: { userId }
    });

    if (!assistant) {
      return res.status(404).json({ error: 'Perfil de asistente no encontrado' });
    }

    const { doctorId } = req.query;

    // Configurar fechas para "Hoy" en zona horaria UTC-5 (Ecuador)
    const nowUtc = new Date();
    const ecuadorTime = new Date(nowUtc.getTime() - (5 * 60 * 60 * 1000));
    const dateStr = ecuadorTime.toISOString().split('T')[0];
    const dateStart = new Date(`${dateStr}T00:00:00.000Z`);
    const dateEnd = new Date(`${dateStr}T23:59:59.999Z`);

    const dateFilter = {
      gte: dateStart,
      lte: dateEnd
    };

    let whereClause: any = {
      date: dateFilter
    };

    if (assistant.clinicProfileId) {
      // Escenario A: Macroclínica
      whereClause.clinicProfileId = assistant.clinicProfileId;
      if (doctorId && typeof doctorId === 'string') {
        whereClause.doctorProfileId = doctorId;
      }
    } else if (assistant.doctorProfileId) {
      // Escenario B: Asistente Privado
      whereClause.doctorProfileId = assistant.doctorProfileId;
    } else {
      return res.status(403).json({ error: 'El asistente no está asignado a ninguna clínica ni médico' });
    }

    const appointments = await prisma.appointment.findMany({
      where: whereClause,
      orderBy: {
        startTime: 'asc'
      },
      include: {
        patient: {
          select: { id: true, firstName: true, lastName: true, email: true, phone: true }
        },
        doctorProfile: {
          include: {
            user: {
              select: { id: true, firstName: true, lastName: true }
            }
          }
        },
        service: true
      }
    });

    const pendingPayments = appointments.filter(
      appt => appt.paymentStatus === 'PENDING_CASH' && appt.paymentMethod === 'CASH'
    );

    return res.status(200).json({
      queue: appointments,
      pendingPayments
    });

  } catch (error) {
    console.error('[Assistant Controller] Error en getAssistantDashboard:', error);
    return res.status(500).json({ error: 'Error al obtener el dashboard del asistente' });
  }
};

export const startConsultation = async (req: AuthRequest, res: Response) => {
  try {
    if (!req.user) return res.status(401).json({ error: 'UNAUTHORIZED' });
    markDeprecated(res, '/api/bookings/:id/start');
    const updated = await startAppointment(String(req.params.id), legacyActor(req));
    return res.status(200).json({ message: 'Consulta iniciada', appointment: updated });
  } catch (error) {
    return legacyError(error, res);
  }
};

export const completeConsultation = async (req: AuthRequest, res: Response) => {
  try {
    if (!req.user) return res.status(401).json({ error: 'UNAUTHORIZED' });
    markDeprecated(res, '/api/bookings/:id/complete');
    const updated = await completeAppointment(String(req.params.id), legacyActor(req));
    return res.status(200).json({ message: 'Consulta completada', appointment: updated });
  } catch (error) {
    return legacyError(error, res);
  }
};

export const markAsMissed = async (req: AuthRequest, res: Response) => {
  try {
    if (!req.user) return res.status(401).json({ error: 'UNAUTHORIZED' });
    const id = String(req.params.id);
    markDeprecated(res, '/api/bookings/:id/no-show');
    const updated = await markAppointmentNoShow(id, legacyActor(req));
    deleteCalendarEvent(id).catch(console.error);

    return res.status(200).json({ message: 'Paciente marcado como no asistió', appointment: updated });
  } catch (error) {
    return legacyError(error, res);
  }
};

export const postponeTurn = async (req: AuthRequest, res: Response) => {
  try {
    if (!req.user) return res.status(401).json({ error: 'UNAUTHORIZED' });
    markDeprecated(res, '/api/turns/:id/delay');
    const turn = await postponeAppointmentTurn(String(req.params.id), legacyActor(req));
    return res.status(200).json({ message: 'Turno pospuesto exitosamente', turn });
  } catch (error) {
    return legacyError(error, res);
  }
};
