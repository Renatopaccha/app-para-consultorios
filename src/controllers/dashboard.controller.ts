import { Response } from 'express';
import { AuthRequest } from '../middlewares/auth.middleware';
import prisma from '../prisma';
import { startOfDay, endOfDay, startOfWeek, endOfWeek, startOfMonth, endOfMonth, parseISO, isValid } from 'date-fns';

export const getClinicDashboardMetrics = async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.user?.id;
    const role = req.user?.role;

    if (!userId || !role) {
      return res.status(401).json({ error: 'No autorizado' });
    }

    let clinicProfileId: string | null = null;

    if (role === 'CLINIC_ADMIN') {
      const clinic = await prisma.clinicProfile.findUnique({ where: { userId } });
      if (clinic) clinicProfileId = clinic.id;
    } else if (role === 'ASSISTANT') {
      const assistant = await prisma.assistantProfile.findUnique({ where: { userId } });
      if (assistant) clinicProfileId = assistant.clinicProfileId;
    }

    if (!clinicProfileId) {
      return res.status(403).json({ error: 'No tienes un perfil de clínica asociado' });
    }

    const { startDate, endDate } = req.query;
    
    // Rango de fechas por defecto: últimos 30 días
    const now = new Date();
    let fromDate = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
    let toDate = now;

    if (startDate && typeof startDate === 'string') {
      fromDate = new Date(startDate);
    }
    if (endDate && typeof endDate === 'string') {
      toDate = new Date(endDate);
      toDate.setUTCHours(23, 59, 59, 999);
    }

    const dateFilter = {
      gte: fromDate,
      lte: toDate
    };

    // Realizar consultas en paralelo
    const [
      totalScheduled,
      totalCancelled,
      totalCompleted,
      appointmentsWithServices
    ] = await Promise.all([
      prisma.appointment.count({
        where: { clinicProfileId, date: dateFilter }
      }),
      prisma.appointment.count({
        where: { clinicProfileId, date: dateFilter, status: 'CANCELLED' }
      }),
      prisma.appointment.count({
        where: { clinicProfileId, date: dateFilter, status: 'COMPLETED' } // o CONFIRMED/PAID
      }),
      // Para ingresos y top servicios necesitamos los servicios asociados
      prisma.appointment.findMany({
        where: { clinicProfileId, date: dateFilter, paymentStatus: 'PAID' },
        include: { service: true }
      })
    ]);

    // Calcular ingresos totales
    const totalRevenue = appointmentsWithServices.reduce((sum, appt) => {
      return sum + (appt.service?.price || 0);
    }, 0);

    // Calcular top 5 servicios
    const serviceCounts: Record<string, { name: string; count: number }> = {};
    appointmentsWithServices.forEach(appt => {
      const srvId = appt.serviceId;
      const srvName = appt.service.name;
      if (!serviceCounts[srvId]) {
        serviceCounts[srvId] = { name: srvName, count: 0 };
      }
      serviceCounts[srvId].count++;
    });

    const topServices = Object.values(serviceCounts)
      .sort((a, b) => b.count - a.count)
      .slice(0, 5);

    return res.status(200).json({
      summary: {
        totalScheduled,
        totalCancelled,
        totalCompleted,
      },
      revenue: {
        total: totalRevenue
      },
      topServices,
      dateRange: {
        from: fromDate,
        to: toDate
      }
    });

  } catch (error) {
    console.error('[Dashboard Controller] Error en getClinicDashboardMetrics:', error);
    return res.status(500).json({ error: 'Error al obtener las métricas del dashboard' });
  }
};
export const getMetrics = async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.user?.id;
    const { type, date } = req.query;

    if (!type || !date || typeof date !== 'string' || date === 'undefined') {
      return res.status(400).json({ error: 'Parámetros inválidos. Se requiere "type" y "date".' });
    }

    const doctor = await prisma.doctorProfile.findUnique({ where: { userId } });
    if (!doctor) {
      if (type === 'daily') return res.status(200).json({ total_today: 0, confirmed_today: 0, pending_today: 0 });
      if (type === 'weekly') return res.status(200).json({ total_week: 0, confirmed_week: 0, pending_week: 0, blocked_hours_week: 0 });
      if (type === 'monthly') return res.status(200).json({ patients_attended_month: 0, new_patients_month: 0, cancelled_month: 0 });
      return res.status(200).json({});
    }

    const baseDate = parseISO(date);
    if (!isValid(baseDate)) {
      return res.status(400).json({ error: 'Formato de fecha inválido.' });
    }

    let start: Date, end: Date;

    switch (type) {
      case 'daily':
        start = startOfDay(baseDate);
        end = endOfDay(baseDate);
        break;
      case 'weekly':
        start = startOfWeek(baseDate, { weekStartsOn: 1 });
        end = endOfWeek(baseDate, { weekStartsOn: 1 });
        break;
      case 'monthly':
        start = startOfMonth(baseDate);
        end = endOfMonth(baseDate);
        break;
      default:
        return res.status(400).json({ error: 'Tipo inválido. Usa daily, weekly o monthly.' });
    }

    const whereClause = {
      doctorProfileId: doctor.id,
      startDatetime: { gte: start, lte: end }
    };

    if (type === 'daily') {
      const [total_today, confirmed_today, pending_today] = await Promise.all([
        prisma.appointment.count({ where: whereClause }),
        prisma.appointment.count({ where: { ...whereClause, status: 'CONFIRMED' } }),
        prisma.appointment.count({ where: { ...whereClause, paymentStatus: { not: 'PAID' } } })
      ]);
      return res.json({ total_today, confirmed_today, pending_today });
    }

    if (type === 'weekly') {
      const [total_week, confirmed_week, pending_week, blockedAppointments] = await Promise.all([
        prisma.appointment.count({ where: whereClause }),
        prisma.appointment.count({ where: { ...whereClause, status: 'CONFIRMED' } }),
        prisma.appointment.count({ where: { ...whereClause, paymentStatus: { not: 'PAID' } } }),
        prisma.appointment.findMany({ 
          where: { ...whereClause, service: { name: { contains: 'bloqueo', mode: 'insensitive' } } },
          include: { service: true }
        })
      ]);

      const blockedMinutes = blockedAppointments.reduce((acc, appt) => acc + (appt.service?.duration || 0), 0);
      return res.json({
        total_week,
        confirmed_week,
        pending_week,
        blocked_hours_week: Math.floor(blockedMinutes / 60)
      });
    }

    if (type === 'monthly') {
      const [cancelled_month, uniquePatients] = await Promise.all([
        prisma.appointment.count({ where: { ...whereClause, status: 'CANCELLED' } }),
        prisma.appointment.findMany({
          where: whereClause,
          select: { patientId: true },
          distinct: ['patientId'] // <-- Solo trae IDs únicos
        })
      ]);

      return res.json({
        patients_attended_month: uniquePatients.length,
        new_patients_month: 0, // Por ahora 0, se implementará lógica de negocio luego
        cancelled_month
      });
    }

  } catch (error) {
    console.error('[Dashboard Controller] Error en getMetrics:', error);
    return res.status(500).json({ error: 'Error calculando métricas' });
  }
};

