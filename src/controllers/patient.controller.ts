import { Response } from 'express';
import { AuthRequest } from '../middlewares/auth.middleware';
import prisma from '../prisma';
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

    const { doctorId, clinicId, date, startTime, serviceId } = req.body;

    if (!doctorId || !clinicId || !date || !startTime || !serviceId) {
      return res.status(400).json({ error: 'Faltan campos obligatorios (doctorId, clinicId, date, startTime, serviceId)' });
    }

    const appointmentDate = new Date(date);

    // 1. Verificamos que el doctor, la clínica y el servicio realmente existen
    const doctorExists = await prisma.doctorProfile.findUnique({ 
      where: { id: doctorId },
      include: { user: true } // Traemos el user para obtener su email
    });
    const clinicExists = await prisma.clinicProfile.findUnique({ where: { id: clinicId } });
    const serviceExists = await prisma.service.findUnique({ where: { id: serviceId } });

    if (!doctorExists || doctorExists.verificationStatus !== 'APPROVED' || !clinicExists || clinicExists.verificationStatus !== 'APPROVED' || !serviceExists) {
      return res.status(404).json({ error: 'El doctor, la clínica o el servicio especificado no existen.' });
    }

    // Calcular endTime en base a la duración del servicio
    const durationMinutes = serviceExists.duration || 30;
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

    const appointment = await prisma.appointment.create({
      data: {
        patientId, // <-- CRÍTICO: ID blindado extraído del Token JWT, imposible de inyectar por Body
        doctorProfileId: doctorId,
        clinicProfileId: clinicId,
        serviceId: serviceId,
        date: appointmentDate,
        startTime,
        endTime,
        status: 'PENDING'
      }
    });

    // Enviar notificación al doctor
    if (doctorExists.user && doctorExists.user.email) {
      const emailHtml = `
        <h3>¡Nueva cita agendada en Vitali!</h3>
        <p>Doctor(a) ${doctorExists.user.firstName} ${doctorExists.user.lastName},</p>
        <p>Se ha reservado un espacio en su agenda para la fecha <strong>${date}</strong> de <strong>${startTime}</strong> a <strong>${endTime}</strong>.</p>
        <p>Servicio solicitado: <strong>${serviceExists.name}</strong></p>
        <p>Revise su panel médico para más detalles.</p>
      `;
      // Llamada asíncrona "fire and forget"
      notificationService.sendEmail(doctorExists.user.email, 'Nueva Cita Vitali', emailHtml).catch(console.error);
    }

    res.status(201).json(appointment);
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
