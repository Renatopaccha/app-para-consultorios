import { Request, Response } from 'express';
import prisma from '../prisma';

export const getReviews = async (req: Request, res: Response) => {
  try {
    const reviews = await prisma.review.findMany();
    res.json(reviews);
  } catch (error) {
    res.status(500).json({ error: 'Error al obtener reseñas' });
  }
};

export const getReviewById = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const review = await prisma.review.findUnique({ where: { id } });
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
    const review = await prisma.review.create({ data: req.body });
    res.status(201).json(review);
  } catch (error) {
    res.status(500).json({ error: 'Error al crear reseña' });
  }
};
