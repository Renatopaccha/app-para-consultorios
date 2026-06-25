import { Request, Response } from 'express';
import prisma from '../prisma';

export const getClinics = async (req: Request, res: Response) => {
  try {
    const page = parseInt(req.query.page as string) || 1;
    const limit = parseInt(req.query.limit as string) || 10;
    const skip = (page - 1) * limit;

    const clinics = await prisma.clinic.findMany({
      skip,
      take: limit,
      select: {
        id: true,
        name: true,
        address: true,
        latitude: true,
        longitude: true,
        phone: true,
        subscriptionStatus: true,
        createdAt: true,
        updatedAt: true,
      },
    });
    res.json(clinics);
  } catch (error) {
    res.status(500).json({ error: 'Error al obtener clínicas' });
  }
};

export const getClinicById = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;

    const clinic = await prisma.clinic.findUnique({ 
      where: { id: id as string },
      select: {
        id: true,
        name: true,
        address: true,
        latitude: true,
        longitude: true,
        phone: true,
        subscriptionStatus: true,
        createdAt: true,
        updatedAt: true,
      },
    });

    if (!clinic) {
      return res.status(404).json({ error: 'Clínica no encontrada' });
    }

    res.json(clinic);
  } catch (error) {
    res.status(500).json({ error: 'Error al obtener clínica' });
  }
};

export const createClinic = async (req: Request, res: Response) => {
  try {
    const { name, address } = req.body;
    if (!name || !address) {
      return res.status(400).json({ error: 'Faltan campos requeridos (name, address)' });
    }

    const clinic = await prisma.clinic.create({ 
      data: req.body,
      select: {
        id: true,
        name: true,
        address: true,
        latitude: true,
        longitude: true,
        phone: true,
        subscriptionStatus: true,
        createdAt: true,
        updatedAt: true,
      },
    });
    res.status(201).json(clinic);
  } catch (error) {
    res.status(500).json({ error: 'Error al crear clínica' });
  }
};