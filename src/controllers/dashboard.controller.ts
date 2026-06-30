import { Response } from 'express';
import { AuthRequest } from '../middlewares/auth.middleware';
import prisma from '../prisma';

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
