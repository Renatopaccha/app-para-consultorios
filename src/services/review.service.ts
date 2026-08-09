import { Prisma } from '../../generated/prisma';
import prisma from '../prisma';
import { localDateTimeToUtc } from '../utils/scheduling';

export class ReviewDomainError extends Error {
  constructor(public readonly status: number, public readonly code: string, message: string) {
    super(message);
  }
}

export interface DoctorReviewFilters {
  page: number;
  pageSize: number;
  rating?: number;
  from?: string;
  to?: string;
  clinicId?: string;
  serviceId?: string;
}

const PATIENT_DISPLAY_NAME = 'Paciente verificado';

function validLocalDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

function parsePositiveInteger(value: unknown, fallback: number, maximum?: number): number {
  if (value === undefined) return fallback;
  if (typeof value !== 'string' || !/^\d+$/.test(value)) {
    throw new ReviewDomainError(422, 'INVALID_REVIEW_FILTERS', 'Los parámetros de paginación deben ser enteros positivos.');
  }
  const parsed = Number(value);
  if (parsed < 1 || (maximum !== undefined && parsed > maximum)) {
    throw new ReviewDomainError(422, 'INVALID_REVIEW_FILTERS', maximum ? `El valor debe estar entre 1 y ${maximum}.` : 'El valor debe ser mayor que cero.');
  }
  return parsed;
}

export function parseDoctorReviewFilters(query: Record<string, unknown>): DoctorReviewFilters {
  const page = parsePositiveInteger(query.page, 1);
  const pageSize = parsePositiveInteger(query.pageSize, 10, 50);
  let rating: number | undefined;
  if (query.rating !== undefined) rating = parsePositiveInteger(query.rating, 1, 5);

  const from = typeof query.from === 'string' && query.from.trim() ? query.from.trim() : undefined;
  const to = typeof query.to === 'string' && query.to.trim() ? query.to.trim() : undefined;
  if ((from && !validLocalDate(from)) || (to && !validLocalDate(to))) {
    throw new ReviewDomainError(422, 'INVALID_REVIEW_FILTERS', 'Las fechas deben usar el formato YYYY-MM-DD.');
  }
  if (from && to && from > to) {
    throw new ReviewDomainError(422, 'INVALID_REVIEW_FILTERS', 'La fecha inicial no puede ser posterior a la final.');
  }

  const optionalId = (value: unknown, name: string) => {
    if (value === undefined) return undefined;
    if (typeof value !== 'string' || !value.trim()) throw new ReviewDomainError(422, 'INVALID_REVIEW_FILTERS', `${name} no es válido.`);
    return value.trim();
  };

  return {
    page,
    pageSize,
    ...(rating ? { rating } : {}),
    ...(from ? { from } : {}),
    ...(to ? { to } : {}),
    ...(optionalId(query.clinicId, 'clinicId') ? { clinicId: optionalId(query.clinicId, 'clinicId') } : {}),
    ...(optionalId(query.serviceId, 'serviceId') ? { serviceId: optionalId(query.serviceId, 'serviceId') } : {}),
  };
}

function safeReviewItem(review: {
  id: string;
  rating: number;
  comment: string | null;
  createdAt: Date;
  appointment: { serviceNameSnapshot: string | null; service: { name: string }; clinicProfile: { name: string } };
}) {
  return {
    id: review.id,
    rating: review.rating,
    comment: review.comment,
    createdAt: review.createdAt.toISOString(),
    patientDisplayName: PATIENT_DISPLAY_NAME,
    serviceName: review.appointment.serviceNameSnapshot || review.appointment.service.name,
    clinicName: review.appointment.clinicProfile.name || null,
  };
}

function distributionFromGroups(groups: Array<{ rating: number; _count: { _all: number } }>) {
  const counts = new Map(groups.map((group) => [group.rating, group._count._all]));
  return { one: counts.get(1) ?? 0, two: counts.get(2) ?? 0, three: counts.get(3) ?? 0, four: counts.get(4) ?? 0, five: counts.get(5) ?? 0 };
}

async function buildReviewsResponse(where: Prisma.ReviewWhereInput, filters: Pick<DoctorReviewFilters, 'page' | 'pageSize'>) {
  const [reviews, aggregation, groups] = await prisma.$transaction([
    prisma.review.findMany({
      where,
      select: {
        id: true,
        rating: true,
        comment: true,
        createdAt: true,
        appointment: {
          select: {
            serviceNameSnapshot: true,
            service: { select: { name: true } },
            clinicProfile: { select: { name: true } },
          },
        },
      },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      skip: (filters.page - 1) * filters.pageSize,
      take: filters.pageSize,
    }),
    prisma.review.aggregate({ where, _avg: { rating: true }, _count: { _all: true } }),
    prisma.review.groupBy({ by: ['rating'], where, _count: { _all: true } }),
  ]);
  const totalItems = aggregation._count._all;
  return {
    summary: {
      averageRating: aggregation._avg.rating === null ? null : Number(aggregation._avg.rating.toFixed(1)),
      totalReviews: totalItems,
      distribution: distributionFromGroups(groups),
    },
    items: reviews.map(safeReviewItem),
    pagination: { page: filters.page, pageSize: filters.pageSize, totalItems, totalPages: Math.ceil(totalItems / filters.pageSize) },
  };
}

export async function listMyDoctorReviews(userId: string, filters: DoctorReviewFilters) {
  const doctor = await prisma.doctorProfile.findUnique({ where: { userId }, select: { id: true } });
  if (!doctor) throw new ReviewDomainError(404, 'DOCTOR_PROFILE_NOT_FOUND', 'No existe un perfil médico para esta sesión.');

  if (filters.clinicId) {
    const workplace = await prisma.doctorClinicWorkplace.findUnique({
      where: { doctorProfileId_clinicProfileId: { doctorProfileId: doctor.id, clinicProfileId: filters.clinicId } },
      select: { isActive: true },
    });
    if (!workplace?.isActive) throw new ReviewDomainError(403, 'CLINIC_NOT_LINKED', 'La sede no está vinculada activamente a tu perfil.');
  }

  if (filters.serviceId) {
    const service = await prisma.service.findFirst({ where: { id: filters.serviceId, doctorProfileId: doctor.id }, select: { id: true } });
    if (!service) throw new ReviewDomainError(403, 'SERVICE_NOT_OWNED', 'El servicio no pertenece a tu perfil.');
  }

  const createdAt: Prisma.DateTimeFilter | undefined = filters.from || filters.to ? {
    ...(filters.from ? { gte: localDateTimeToUtc(filters.from, '00:00:00') } : {}),
    ...(filters.to ? { lt: new Date(localDateTimeToUtc(filters.to, '00:00:00').getTime() + 86_400_000) } : {}),
  } : undefined;
  const where: Prisma.ReviewWhereInput = {
    doctorProfileId: doctor.id,
    ...(filters.rating ? { rating: filters.rating } : {}),
    ...(createdAt ? { createdAt } : {}),
    appointment: {
      status: 'COMPLETED',
      ...(filters.clinicId ? { clinicProfileId: filters.clinicId } : {}),
      ...(filters.serviceId ? { serviceId: filters.serviceId } : {}),
    },
  };
  return buildReviewsResponse(where, filters);
}

export async function listPublicDoctorReviews(doctorProfileId: string) {
  return buildReviewsResponse({ doctorProfileId, appointment: { status: 'COMPLETED' } }, { page: 1, pageSize: 20 });
}
