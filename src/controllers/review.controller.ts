import { Response } from 'express';
import { AuthRequest } from '../middlewares/auth.middleware';
import prisma from '../prisma';
import { listMyDoctorReviews, listPublicDoctorReviews, parseDoctorReviewFilters, ReviewDomainError } from '../services/review.service';

function fail(res: Response, status: number, error: string, message: string) {
  return res.status(status).json({ error, message });
}

export const createReview = async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.user?.id;
    if (!userId) return res.status(401).json({ error: 'No autorizado' });

    const { appointmentId, rating, comment } = req.body as { appointmentId?: unknown; rating?: unknown; comment?: unknown };

    if (!appointmentId || rating === undefined) {
      return fail(res, 422, 'INVALID_REVIEW', 'Faltan campos requeridos (appointmentId, rating).');
    }

    const parsedRating = parseInt(String(rating));
    if (isNaN(parsedRating) || parsedRating < 1 || parsedRating > 5) {
      return fail(res, 422, 'INVALID_REVIEW_RATING', 'El rating debe ser un número entero entre 1 y 5.');
    }

    if (String(parsedRating) !== String(rating)) return fail(res, 422, 'INVALID_REVIEW_RATING', 'El rating debe ser un número entero entre 1 y 5.');
    if (comment !== undefined && comment !== null && typeof comment !== 'string') return fail(res, 422, 'INVALID_REVIEW_COMMENT', 'El comentario debe ser texto.');
    const normalizedComment = typeof comment === 'string' ? comment.trim() : '';
    if (normalizedComment.length > 2000) return fail(res, 422, 'INVALID_REVIEW_COMMENT', 'El comentario no puede exceder 2000 caracteres.');

    // Buscar la cita
    const appointment = await prisma.appointment.findUnique({
      where: { id: String(appointmentId) }
    });

    if (!appointment) {
      return fail(res, 404, 'APPOINTMENT_NOT_FOUND', 'Cita no encontrada.');
    }

    // Validación 1: Seguridad
    if (appointment.patientId !== userId) {
      return fail(res, 403, 'APPOINTMENT_NOT_OWNED', 'Solo el paciente dueño de la cita puede opinar.');
    }

    // Validación 2: Regla de Negocio
    if (appointment.status !== 'COMPLETED') {
      return fail(res, 400, 'APPOINTMENT_NOT_COMPLETED', 'Solo puedes calificar una cita finalizada.');
    }

    // Validación 3: Prevención de Spam
    const existingReview = await prisma.review.findUnique({
      where: { appointmentId: appointment.id }
    });

    if (existingReview) {
      return fail(res, 409, 'REVIEW_ALREADY_EXISTS', 'Ya existe una reseña para esta cita.');
    }

    // Crear la reseña
    const review = await prisma.review.create({
      data: {
        appointmentId: appointment.id,
        patientId: userId,
        doctorProfileId: appointment.doctorProfileId,
        rating: parsedRating,
        comment: normalizedComment || null
      }
    });

    return res.status(201).json({
      message: 'Reseña guardada exitosamente',
      review: { id: review.id, rating: review.rating, comment: review.comment, createdAt: review.createdAt.toISOString() },
    });
  } catch (error) {
    if (typeof error === 'object' && error !== null && 'code' in error && error.code === 'P2002') {
      return fail(res, 409, 'REVIEW_ALREADY_EXISTS', 'Ya existe una reseña para esta cita.');
    }
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

    return res.status(200).json(await listPublicDoctorReviews(String(doctorId)));
  } catch (error) {
    console.error('[Review Controller] Error en getDoctorReviews:', error);
    return res.status(500).json({ error: 'Error al obtener las reseñas del médico' });
  }
};

export const getMyDoctorReviews = async (req: AuthRequest, res: Response) => {
  try {
    if (!req.user) return fail(res, 401, 'UNAUTHORIZED', 'No autorizado.');
    const filters = parseDoctorReviewFilters(req.query);
    return res.status(200).json(await listMyDoctorReviews(req.user.id, filters));
  } catch (error) {
    if (error instanceof ReviewDomainError) return fail(res, error.status, error.code, error.message);
    console.error('[Review Controller] Error en getMyDoctorReviews:', error instanceof Error ? error.message : error);
    return fail(res, 500, 'REVIEW_LIST_FAILED', 'Error al obtener las reseñas del médico.');
  }
};
