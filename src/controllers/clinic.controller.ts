import { Request, Response } from 'express';
import prisma from '../prisma';

export const getClinics = async (req: Request, res: Response) => {
  try {
    const clinics = await prisma.clinic.findMany();
    res.json(clinics);
  } catch (error) {
    res.status(500).json({ error: 'Error al obtener clínicas' });
  }
};

export const getClinicById = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const clinic = await prisma.clinic.findUnique({ where: { id } });
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
    const clinic = await prisma.clinic.create({ data: req.body });
    res.status(201).json(clinic);
  } catch (error) {
    res.status(500).json({ error: 'Error al crear clínica' });
  }
};
