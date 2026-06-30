import { Response } from 'express';
import { AuthRequest } from '../middlewares/auth.middleware';
import prisma from '../prisma';

export const createReview = async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.user?.id;
    if (!userId) return res.status(401).json({ error: 'No autorizado' });

    const { appointmentId, rating, comment } = req.body;

    if (!appointmentId || rating === undefined) {
      return res.status(400).json({ error: 'Faltan campos requeridos (appointmentId, rating)' });
    }

    const parsedRating = parseInt(String(rating));
    if (isNaN(parsedRating) || parsedRating < 1 || parsedRating > 5) {
      return res.status(400).json({ error: 'El rating debe ser un número entre 1 y 5' });
    }

    // Buscar la cita
    const appointment = await prisma.appointment.findUnique({
      where: { id: String(appointmentId) }
    });

    if (!appointment) {
      return res.status(404).json({ error: 'Cita no encontrada' });
    }

    // Validación 1: Seguridad
    if (appointment.patientId !== userId) {
      return res.status(403).json({ error: 'Solo el paciente dueño de la cita puede opinar' });
    }

    // Validación 2: Regla de Negocio
    if (appointment.status !== 'COMPLETED') {
      return res.status(400).json({ error: 'Solo puedes calificar una cita finalizada' });
    }

    // Validación 3: Prevención de Spam
    const existingReview = await prisma.review.findUnique({
      where: { appointmentId: appointment.id }
    });

    if (existingReview) {
      return res.status(409).json({ error: 'Ya existe una reseña para esta cita' });
    }

    // Crear la reseña
    const review = await prisma.review.create({
      data: {
        appointmentId: appointment.id,
        patientId: userId,
        doctorProfileId: appointment.doctorProfileId,
        rating: parsedRating,
        comment: comment ? String(comment) : null
      }
    });

    return res.status(201).json({ message: 'Reseña guardada exitosamente', review });
  } catch (error) {
    console.error('[Review Controller] Error en createReview:', error);
    return res.status(500).json({ error: 'Error al crear la reseña' });
  }
};

export const getDoctorReviews = async (req: AuthRequest, res: Response) => {
  try {
    const { doctorId } = req.params;
    if (!doctorId) {
      return res.status(400).json({ error: 'El doctorId es requerido' });
    }

    // Obtener las reseñas del doctor
    const reviews = await prisma.review.findMany({
      where: { doctorProfileId: String(doctorId) },
      include: {
        patient: {
          select: { firstName: true }
        }
      },
      orderBy: { createdAt: 'desc' }
    });

    // Calcular promedios usando prisma.aggregate
    const aggregation = await prisma.review.aggregate({
      where: { doctorProfileId: String(doctorId) },
      _avg: { rating: true },
      _count: { id: true }
    });

    const averageRating = aggregation._avg.rating || 0;
    const totalReviews = aggregation._count.id || 0;

    return res.status(200).json({
      summary: {
        averageRating: Number(averageRating.toFixed(1)),
        totalReviews
      },
      reviews
    });
  } catch (error) {
    console.error('[Review Controller] Error en getDoctorReviews:', error);
    return res.status(500).json({ error: 'Error al obtener las reseñas del médico' });
  }
};
