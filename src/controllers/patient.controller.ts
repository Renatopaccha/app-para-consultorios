import { Response } from 'express';
import { AuthRequest } from '../middlewares/auth.middleware';
import prisma from '../prisma';

/**
 * 1. GET /api/patients/doctors (Buscador)
 * Devuelve una lista de doctores activos con la información de su clínica.
 */
export const getActiveDoctors = async (req: AuthRequest, res: Response) => {
  try {
    const page = parseInt(req.query.page as string) || 1;
    const limit = parseInt(req.query.limit as string) || 20;
    const skip = (page - 1) * limit;

    const doctors = await prisma.doctor.findMany({
      where: {
        isVerified: true, // Asumimos que los activos son los verificados
      },
      skip,
      take: limit,
      select: {
        id: true,
        licenseNumber: true,
        isVerified: true,
        consultationPrice: true,
        clinic: {
          select: {
            id: true,
            name: true,
            address: true,
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

    const { doctorId, clinicId, date, time } = req.body;

    if (!doctorId || !clinicId || !date || !time) {
      return res.status(400).json({ error: 'Faltan campos obligatorios (doctorId, clinicId, date, time)' });
    }

    const appointmentDate = new Date(date);

    // 1. Verificamos que el doctor y la clínica realmente existen
    const doctorExists = await prisma.doctor.findUnique({ where: { id: doctorId } });
    const clinicExists = await prisma.clinic.findUnique({ where: { id: clinicId } });

    if (!doctorExists || !clinicExists) {
      return res.status(404).json({ error: 'El doctor o la clínica especificada no existen.' });
    }

    const appointment = await prisma.appointment.create({
      data: {
        patientId, // <-- CRÍTICO: ID blindado extraído del Token JWT, imposible de inyectar por Body
        doctorId,
        clinicId,
        date: appointmentDate,
        time,
        status: 'PENDING'
      }
    });

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
        doctor: {
          select: {
            id: true,
            licenseNumber: true,
            consultationPrice: true,
          }
        },
        clinic: {
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
