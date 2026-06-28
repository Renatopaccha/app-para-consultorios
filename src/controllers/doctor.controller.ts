import { Request, Response } from 'express';
import { AuthRequest } from '../middlewares/auth.middleware';
import prisma from '../prisma';

export const getDoctors = async (req: Request, res: Response) => {
  try {
    const page = parseInt(req.query.page as string) || 1;
    const limit = parseInt(req.query.limit as string) || 10;
    const skip = (page - 1) * limit;

    const doctors = await prisma.doctorProfile.findMany({
      skip,
      take: limit,
      include: {
        user: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
            email: true,
            phone: true
          }
        },
        workplaces: {
          include: {
            clinicProfile: {
              select: {
                id: true,
                name: true,
                address: true
              }
            }
          }
        }
      }
    });
    res.json(doctors);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Error al obtener doctores' });
  }
};

export const getDoctorById = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const doctor = await prisma.doctorProfile.findUnique({ 
      where: { id: id as string },
      include: {
        user: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
            email: true,
            phone: true
          }
        },
        workplaces: {
          include: {
            clinicProfile: {
              select: {
                id: true,
                name: true,
                address: true
              }
            }
          }
        }
      }
    });
    if (!doctor) {
      return res.status(404).json({ error: 'Doctor no encontrado' });
    }
    res.json(doctor);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Error al obtener doctor' });
  }
};

export const createDoctor = async (req: Request, res: Response) => {
  try {
    const { licenseNumber, consultationPrice, userId } = req.body;
    if (!licenseNumber || consultationPrice === undefined || !userId) {
      return res.status(400).json({ error: 'Faltan campos requeridos (licenseNumber, consultationPrice, userId)' });
    }

    const doctor = await prisma.doctorProfile.create({ 
      data: req.body,
      include: {
        user: {
          select: {
            firstName: true,
            lastName: true,
            email: true
          }
        }
      }
    });
    res.status(201).json(doctor);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Error al crear perfil de doctor' });
  }
};

export const getMyAppointments = async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.user?.id;
    if (!userId) {
      return res.status(401).json({ error: 'No autorizado' });
    }

    // Buscamos el perfil del doctor asociado a este usuario
    const doctor = await prisma.doctorProfile.findUnique({
      where: { userId }
    });

    if (!doctor) {
      return res.status(404).json({ error: 'Perfil de doctor no encontrado. ¿Completaste tu registro médico?' });
    }

    const page = parseInt(req.query.page as string) || 1;
    const limit = parseInt(req.query.limit as string) || 20;
    const skip = (page - 1) * limit;

    const appointments = await prisma.appointment.findMany({
      where: {
        doctorProfileId: doctor.id
      },
      skip,
      take: limit,
      orderBy: {
        date: 'asc'
      },
      include: {
        patient: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
            email: true,
            phone: true
          }
        },
        clinicProfile: {
          select: {
            id: true,
            name: true,
            address: true
          }
        }
      }
    });

    res.json(appointments);
  } catch (error) {
    console.error('[Doctor Controller] Error en getMyAppointments:', error);
    res.status(500).json({ error: 'Error al obtener tu agenda de citas' });
  }
};
