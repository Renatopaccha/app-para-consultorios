import { Response } from 'express';
import { AuthRequest } from '../middlewares/auth.middleware';
import prisma from '../prisma';

export const getDoctorDashboard = async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.user?.id;
    if (!userId) {
      return res.status(401).json({ error: 'No autorizado' });
    }

    // Buscamos el perfil de doctor asociado a este usuario
    const doctor = await prisma.doctorProfile.findUnique({
      where: { userId } // Requiere que el esquema tenga userId @unique
    });

    if (!doctor) {
      return res.status(404).json({ error: 'Perfil de doctor no encontrado. ¿Completaste tu registro médico?' });
    }

    // Calculamos el rango de fechas para "hoy"
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    
    const tomorrow = new Date(today);
    tomorrow.setDate(tomorrow.getDate() + 1);

    // Contamos las citas del doctor programadas para el día de hoy
    const appointmentsToday = await prisma.appointment.count({
      where: {
        doctorProfileId: doctor.id,
        date: {
          gte: today,
          lt: tomorrow
        }
      }
    });

    res.json({
      walletBalance: doctor.walletBalance,
      appointmentsToday
    });
  } catch (error) {
    console.error('[Dashboard] Error en getDoctorDashboard:', error);
    res.status(500).json({ error: 'Error interno al cargar el dashboard del doctor' });
  }
};

export const getClinicDashboard = async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.user?.id;
    if (!userId) {
      return res.status(401).json({ error: 'No autorizado' });
    }

    // Buscamos el perfil de la clínica asociada a este usuario
    const clinic = await prisma.clinicProfile.findUnique({
      where: { userId }, // Requiere que el esquema tenga userId @unique
      include: {
        affiliatedDoctors: {
          include: {
            doctorProfile: {
              select: {
                id: true,
                licenseNumber: true,
                isVerified: true
              }
            }
          }
        }
      }
    });

    if (!clinic) {
      return res.status(404).json({ error: 'Perfil de clínica no encontrado' });
    }

    res.json({
      totalDoctors: clinic.affiliatedDoctors.length,
      doctors: clinic.affiliatedDoctors
    });
  } catch (error) {
    console.error('[Dashboard] Error en getClinicDashboard:', error);
    res.status(500).json({ error: 'Error interno al cargar el dashboard de la clínica' });
  }
};
