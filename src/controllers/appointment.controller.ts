import { Request, Response } from 'express';
import prisma from '../prisma';

export const getAppointments = async (req: Request, res: Response) => {
  try {
    const page = parseInt(req.query.page as string) || 1;
    const limit = parseInt(req.query.limit as string) || 10;
    const skip = (page - 1) * limit;

    const appointments = await prisma.appointment.findMany({
      skip,
      take: limit,
    });
    res.json(appointments);
  } catch (error) {
    res.status(500).json({ error: 'Error al obtener citas' });
  }
};

export const getAppointmentById = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const appointment = await prisma.appointment.findUnique({ where: { id: id as string } });
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
    const { patientId, doctorId, clinicId, date, time } = req.body;
    if (!patientId || !doctorId || !clinicId || !date || !time) {
      return res.status(400).json({ error: 'Faltan campos requeridos (patientId, doctorId, clinicId, date, time)' });
    }

    const appointment = await prisma.appointment.create({ data: req.body });
    res.status(201).json(appointment);
  } catch (error) {
    res.status(500).json({ error: 'Error al crear cita' });
  }
};
