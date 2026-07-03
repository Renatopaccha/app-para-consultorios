import { Response } from 'express';
import { AuthRequest } from '../middlewares/auth.middleware';
import prisma from '../prisma';
import { startOfDay, endOfDay, startOfWeek, endOfWeek, startOfMonth, endOfMonth, parseISO } from 'date-fns';

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

    if (!type || !date || typeof date !== 'string') {
      return res.status(400).json({ error: 'Parámetros inválidos. Se requiere "type" y "date".' });
    }

    const doctor = await prisma.doctorProfile.findUnique({ where: { userId } });
    if (!doctor) return res.status(403).json({ error: 'No autorizado' });

    const baseDate = parseISO(date);
    let start: Date;
    let end: Date;

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

    const appointments = await prisma.appointment.findMany({
      where: {
        doctorProfileId: doctor.id,
        startDatetime: { gte: start, lte: end }
      },
      include: { service: true }
    });

    if (type === 'daily') {
      return res.json({
        total_today: appointments.length,
        confirmed_today: appointments.filter(a => a.status === 'CONFIRMED').length,
        pending_today: appointments.filter(a => a.paymentStatus !== 'PAID').length
      });
    }

    if (type === 'weekly') {
      let blockedMinutes = 0;
      appointments.forEach(a => {
        if (a.service?.name?.toLowerCase().includes('bloqueo') && a.service.duration) {
          blockedMinutes += a.service.duration;
        }
      });

      return res.json({
        total_week: appointments.length,
        confirmed_week: appointments.filter(a => a.status === 'CONFIRMED').length,
        pending_week: appointments.filter(a => a.paymentStatus !== 'PAID').length,
        blocked_hours_week: Math.floor(blockedMinutes / 60)
      });
    }

    if (type === 'monthly') {
      const uniquePatients = new Set(appointments.map(a => a.patientId));
      const cancelled_month = appointments.filter(a => a.status === 'CANCELLED').length;

      return res.json({
        patients_attended_month: uniquePatients.size,
        new_patients_month: 0,
        cancelled_month
      });
    }

  } catch (error) {
    console.error('[Dashboard Controller] Error en getMetrics:', error);
    return res.status(500).json({ error: 'Error calculando métricas' });
  }
};

