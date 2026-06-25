import { Request, Response } from 'express';
import { AuthRequest } from '../middlewares/auth.middleware';
import prisma from '../prisma';

export const getDoctors = async (req: Request, res: Response) => {
  try {
    const page = parseInt(req.query.page as string) || 1;
    const limit = parseInt(req.query.limit as string) || 10;
    const skip = (page - 1) * limit;

    const doctors = await prisma.doctor.findMany({
      skip,
      take: limit,
      select: {
        id: true,
        licenseNumber: true,
        isVerified: true,
        consultationPrice: true,
        subscriptionStatus: true,
        subscriptionValidUntil: true,
        paidBy: true,
        createdAt: true,
        updatedAt: true,
      },
    });
    res.json(doctors);
  } catch (error) {
    res.status(500).json({ error: 'Error al obtener doctores' });
  }
};

export const getDoctorById = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const doctor = await prisma.doctor.findUnique({ 
      where: { id: id as string },
      select: {
        id: true,
        licenseNumber: true,
        isVerified: true,
        consultationPrice: true,
        subscriptionStatus: true,
        subscriptionValidUntil: true,
        paidBy: true,
        createdAt: true,
        updatedAt: true,
      },
    });
    if (!doctor) {
      return res.status(404).json({ error: 'Doctor no encontrado' });
    }
    res.json(doctor);
  } catch (error) {
    res.status(500).json({ error: 'Error al obtener doctor' });
  }
};

export const createDoctor = async (req: Request, res: Response) => {
  try {
    const { licenseNumber, consultationPrice } = req.body;
    if (!licenseNumber || consultationPrice === undefined) {
      return res.status(400).json({ error: 'Faltan campos requeridos (licenseNumber, consultationPrice)' });
    }

    const doctor = await prisma.doctor.create({ 
      data: req.body,
      select: {
        id: true,
        licenseNumber: true,
        isVerified: true,
        consultationPrice: true,
        subscriptionStatus: true,
        subscriptionValidUntil: true,
        paidBy: true,
        createdAt: true,
        updatedAt: true,
      },
    });
    res.status(201).json(doctor);
  } catch (error) {
    res.status(500).json({ error: 'Error al crear doctor' });
  }
};

export const getMyAppointments = async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.user?.id;
    if (!userId) {
      return res.status(401).json({ error: 'No autorizado' });
    }

    // Buscamos el perfil del doctor asociado a este usuario
    const doctor = await prisma.doctor.findUnique({
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
        doctorId: doctor.id
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
        clinic: {
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
