import { Response } from 'express';
import { AuthRequest } from '../middlewares/auth.middleware';
import prisma from '../prisma';
import { deleteCalendarEvent } from '../services/calendarSync.service';

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
      appt => appt.paymentStatus === 'PENDING' && appt.paymentMethod === 'CASH'
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
    const id = req.params.id as string;
    const appointment = await prisma.appointment.findUnique({ where: { id } });

    if (!appointment) return res.status(404).json({ error: 'Cita no encontrada' });
    if (appointment.status !== 'CONFIRMED') {
      return res.status(400).json({ error: 'La cita debe estar confirmada para iniciar' });
    }

    const updated = await prisma.appointment.update({
      where: { id },
      data: { status: 'IN_PROGRESS' }
    });

    return res.status(200).json({ message: 'Consulta iniciada', appointment: updated });
  } catch (error) {
    console.error('[Assistant Controller] Error en startConsultation:', error);
    return res.status(500).json({ error: 'Error al iniciar consulta' });
  }
};

export const completeConsultation = async (req: AuthRequest, res: Response) => {
  try {
    const id = req.params.id as string;
    const appointment = await prisma.appointment.findUnique({ where: { id } });

    if (!appointment) return res.status(404).json({ error: 'Cita no encontrada' });
    if (appointment.status !== 'IN_PROGRESS') {
      return res.status(400).json({ error: 'La cita debe estar en progreso para completarse' });
    }

    const updated = await prisma.appointment.update({
      where: { id },
      data: { status: 'COMPLETED' }
    });

    return res.status(200).json({ message: 'Consulta completada', appointment: updated });
  } catch (error) {
    console.error('[Assistant Controller] Error en completeConsultation:', error);
    return res.status(500).json({ error: 'Error al completar consulta' });
  }
};

export const markAsMissed = async (req: AuthRequest, res: Response) => {
  try {
    const id = req.params.id as string;
    const appointment = await prisma.appointment.findUnique({ where: { id } });

    if (!appointment) return res.status(404).json({ error: 'Cita no encontrada' });

    const updated = await prisma.appointment.update({
      where: { id },
      data: { status: 'MISSED' }
    });

    deleteCalendarEvent(id).catch(console.error);

    return res.status(200).json({ message: 'Paciente marcado como no asistió', appointment: updated });
  } catch (error) {
    console.error('[Assistant Controller] Error en markAsMissed:', error);
    return res.status(500).json({ error: 'Error al marcar como no asistió' });
  }
};

export const postponeTurn = async (req: AuthRequest, res: Response) => {
  try {
    const id = req.params.id as string;
    const appointment = await prisma.appointment.findUnique({ where: { id } });

    if (!appointment) return res.status(404).json({ error: 'Cita no encontrada' });
    if (appointment.status !== 'CONFIRMED') {
      return res.status(400).json({ error: 'La cita debe estar confirmada para posponerse' });
    }

    // Calcular el inicio y fin del día para buscar el máximo turnNumber del doctor hoy
    const appointmentDate = new Date(appointment.date);
    const dateStr = appointmentDate.toISOString().split('T')[0];
    const dateStart = new Date(`${dateStr}T00:00:00.000Z`);
    const dateEnd = new Date(`${dateStr}T23:59:59.999Z`);

    const maxTurnAgg = await prisma.appointment.aggregate({
      _max: {
        turnNumber: true
      },
      where: {
        doctorProfileId: appointment.doctorProfileId,
        date: { gte: dateStart, lte: dateEnd },
        status: { not: 'CANCELLED' }
      }
    });

    const maxTurn = maxTurnAgg._max.turnNumber || 0;
    const newTurn = maxTurn + 1;

    const updated = await prisma.appointment.update({
      where: { id },
      data: { turnNumber: newTurn }
    });

    return res.status(200).json({ message: 'Turno pospuesto exitosamente', appointment: updated });
  } catch (error) {
    console.error('[Assistant Controller] Error en postponeTurn:', error);
    return res.status(500).json({ error: 'Error al posponer turno' });
  }
};

