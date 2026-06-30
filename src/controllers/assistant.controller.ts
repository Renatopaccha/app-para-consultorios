import { Response } from 'express';
import { AuthRequest } from '../middlewares/auth.middleware';
import prisma from '../prisma';

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

export const callNextTurn = async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.user?.id;
    const role = req.user?.role;
    let targetDoctorId = req.body.doctorId as string | undefined;

    if (!userId || !['DOCTOR', 'ASSISTANT'].includes(role || '')) {
      return res.status(401).json({ error: 'No autorizado' });
    }

    if (role === 'DOCTOR') {
      const doctorProfile = await prisma.doctorProfile.findUnique({ where: { userId } });
      if (!doctorProfile) return res.status(404).json({ error: 'Perfil de doctor no encontrado' });
      targetDoctorId = doctorProfile.id;
    } else if (role === 'ASSISTANT') {
      const assistant = await prisma.assistantProfile.findUnique({ where: { userId } });
      if (!assistant) return res.status(404).json({ error: 'Perfil de asistente no encontrado' });
      
      if (assistant.doctorProfileId) {
        targetDoctorId = assistant.doctorProfileId;
      } else if (assistant.clinicProfileId) {
        if (!targetDoctorId) {
          return res.status(400).json({ error: 'El ID del doctor es requerido para asistentes de clínica' });
        }
        // Validate doctor belongs to clinic (optional but good practice)
      } else {
        return res.status(403).json({ error: 'Asistente no asignado' });
      }
    }

    if (!targetDoctorId) {
       return res.status(400).json({ error: 'Falta determinar el médico a consultar' });
    }

    const nowUtc = new Date();
    const ecuadorTime = new Date(nowUtc.getTime() - (5 * 60 * 60 * 1000));
    const dateStr = ecuadorTime.toISOString().split('T')[0];
    const dateStart = new Date(`${dateStr}T00:00:00.000Z`);
    const dateEnd = new Date(`${dateStr}T23:59:59.999Z`);

    // Buscar la siguiente cita (CONFIRMED) ordenada por turnNumber
    const nextAppointment = await prisma.appointment.findFirst({
      where: {
        doctorProfileId: targetDoctorId,
        date: { gte: dateStart, lte: dateEnd },
        status: 'CONFIRMED',
        paymentStatus: 'PAID'
      },
      orderBy: [
        { turnNumber: 'asc' },
        { startTime: 'asc' }
      ],
      include: {
        patient: {
          select: { firstName: true, lastName: true }
        },
        service: {
          select: { name: true }
        }
      }
    });

    if (!nextAppointment) {
      return res.status(404).json({ message: 'No hay más turnos pendientes en la fila' });
    }

    // Actualizar estado a IN_PROGRESS o COMPLETED (según lógica del negocio, usemos COMPLETED por simplicidad o IN_PROGRESS si se añadiera)
    // Usaremos COMPLETED para denotar que ya fue llamado y pasó al consultorio, sacándolo de la fila virtual.
    const updatedAppointment = await prisma.appointment.update({
      where: { id: nextAppointment.id },
      data: { status: 'COMPLETED' }
    });

    return res.status(200).json({
      message: 'Turno llamado exitosamente',
      appointment: nextAppointment
    });

  } catch (error) {
    console.error('[Assistant Controller] Error en callNextTurn:', error);
    return res.status(500).json({ error: 'Error al llamar el siguiente turno' });
  }
};

