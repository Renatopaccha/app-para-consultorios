import { Request, Response } from 'express';
import prisma from '../prisma';

export const getReviews = async (req: Request, res: Response) => {
  try {
    const page = parseInt(req.query.page as string) || 1;
    const limit = parseInt(req.query.limit as string) || 10;
    const skip = (page - 1) * limit;

    const reviews = await prisma.review.findMany({
      skip,
      take: limit,
    });
    res.json(reviews);
  } catch (error) {
    res.status(500).json({ error: 'Error al obtener reseñas' });
  }
};

export const getReviewById = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const review = await prisma.review.findUnique({ where: { id: id as string } });
    if (!review) {
      return res.status(404).json({ error: 'Reseña no encontrada' });
    }
    res.json(review);
  } catch (error) {
    res.status(500).json({ error: 'Error al obtener reseña' });
  }
};

export const createReview = async (req: Request, res: Response) => {
  try {
    const { appointmentId, patientId, doctorId, rating } = req.body;
    if (!appointmentId || !patientId || !doctorId || rating === undefined) {
      return res.status(400).json({ error: 'Faltan campos requeridos (appointmentId, patientId, doctorId, rating)' });
    }

    const { doctorId: _, ...restBody } = req.body;
    const review = await prisma.review.create({ 
      data: {
        ...restBody,
        doctorProfileId: doctorId
      }
    });
    res.status(201).json(review);
  } catch (error) {
    res.status(500).json({ error: 'Error al crear reseña' });
  }
};
