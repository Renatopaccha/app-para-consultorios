import { Request, Response } from 'express';
import prisma from '../prisma';

export const getAppointments = async (req: Request, res: Response) => {
  try {
    const appointments = await prisma.appointment.findMany();
    res.json(appointments);
  } catch (error) {
    res.status(500).json({ error: 'Error al obtener citas' });
  }
};

export const getAppointmentById = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const appointment = await prisma.appointment.findUnique({ where: { id } });
    if (!appointment) {
      return res.status(404).json({ error: 'Cita no encontrada' });
    }
    res.json(appointment);
  } catch (error) {
    res.status(500).json({ error: 'Error al obtener cita' });
  }
};

export const createAppointment = async (req: Request, res: Response) => {
  try {
    const appointment = await prisma.appointment.create({ data: req.body });
    res.status(201).json(appointment);
  } catch (error) {
    res.status(500).json({ error: 'Error al crear cita' });
  }
};
