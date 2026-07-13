import { Response } from 'express';
import { AuthRequest } from '../middlewares/auth.middleware';
import prisma from '../prisma';
import { buildServiceSnapshot } from '../services/serviceSnapshot.service';
import { createAppointment } from '../services/appointmentBooking.service';
import { notificationService } from '../services/notification.service';

/**
 * 1. GET /api/patients/doctors (Buscador)
 * Devuelve una lista de doctores activos con la información de su clínica.
 */
export const getActiveDoctors = async (req: AuthRequest, res: Response) => {
  try {
    const page = parseInt(req.query.page as string) || 1;
    const limit = parseInt(req.query.limit as string) || 20;
    const skip = (page - 1) * limit;

    const doctors = await prisma.doctorProfile.findMany({
      where: {
        isVerified: true, // Asumimos que los activos son los verificados
        verificationStatus: 'APPROVED',
      },
      skip,
      take: limit,
      select: {
        id: true,
        isVerified: true,
        consultationPrice: true,
        workplaces: {
          include: {
            clinicProfile: {
              select: {
                id: true,
                name: true,
                address: true,
              }
            }
          }
        }
      }
    });

    res.json(doctors);
  } catch (error) {
    console.error('[Patient Controller] Error en getActiveDoctors:', error);
    res.status(500).json({ error: 'Error al obtener la lista de doctores' });
  }
};

/**
 * 2. POST /api/patients/appointments (Agendar Cita Segura)
 * Extrae de forma segura el ID del paciente desde el JWT validado.
 */
export const scheduleAppointment = async (req: AuthRequest, res: Response) => {
  try {
    const patientId = req.user?.id;
    if (!patientId) {
      return res.status(401).json({ error: 'No autorizado' });
    }

    const canonical = await createAppointment({ patientUserId: patientId, doctorId: req.body.doctorId, clinicId: req.body.clinicId, serviceId: req.body.serviceId, requestedStart: req.body.startsAt || `${req.body.date}T${req.body.startTime}`, paymentMethod: req.body.paymentMethod });
    res.set('Deprecation', 'true').set('Link', '</api/bookings/book>; rel="successor-version"');
    return res.status(201).json(canonical);
  } catch (error: any) {
    console.error('[Patient Controller] Error en scheduleAppointment:', error);
    
    // 3. Mejoramos el manejo de errores de Prisma
    if (error.code === 'P2003') {
      return res.status(400).json({ error: 'Violación de restricción de llave foránea. Uno de los IDs proporcionados no existe.' });
    }
    if (error.code) {
      return res.status(400).json({ error: `Error en la base de datos (Código: ${error.code})` });
    }

    res.status(500).json({ error: 'Error al agendar la cita' });
  }
};

/**
 * 3. GET /api/patients/my-appointments (Historial)
 * Devuelve todas las citas de manera exclusiva para el usuario que hace la solicitud.
 */
export const getMyAppointments = async (req: AuthRequest, res: Response) => {
  try {
    const patientId = req.user?.id;
    if (!patientId) {
      return res.status(401).json({ error: 'No autorizado' });
    }

    const page = parseInt(req.query.page as string) || 1;
    const limit = parseInt(req.query.limit as string) || 20;
    const skip = (page - 1) * limit;

    const appointments = await prisma.appointment.findMany({
      where: {
        patientId
      },
      skip,
      take: limit,
      orderBy: {
        date: 'desc'
      },
      include: {
        doctorProfile: {
          select: {
            id: true,
            licenseNumber: true,
            consultationPrice: true,
          }
        },
        clinicProfile: {
          select: {
            id: true,
            name: true,
            address: true,
            phone: true
          }
        }
      }
    });

    res.json(appointments);
  } catch (error) {
    console.error('[Patient Controller] Error en getMyAppointments:', error);
    res.status(500).json({ error: 'Error al obtener tu historial de citas' });
  }
};

/**
 * 4. POST /api/patients/fcm-token
 * Guarda o actualiza el FCM Token del paciente para Push Notifications.
 */
export const updateFcmToken = async (req: AuthRequest, res: Response) => {
  try {
    const patientId = req.user?.id;
    if (!patientId) {
      return res.status(401).json({ error: 'No autorizado' });
    }

    const { fcmToken } = req.body;

    if (!fcmToken) {
      return res.status(400).json({ error: 'Falta el campo fcmToken' });
    }

    // Actualizamos el token en el modelo User del paciente
    await prisma.user.update({
      where: { id: patientId },
      data: { fcmToken }
    });

    res.json({ message: 'FCM Token guardado exitosamente' });
  } catch (error) {
    console.error('[Patient Controller] Error en updateFcmToken:', error);
    res.status(500).json({ error: 'Error al guardar el token de notificaciones' });
  }
};
