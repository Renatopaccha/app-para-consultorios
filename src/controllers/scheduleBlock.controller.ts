import type { Response } from 'express';
import { Prisma } from '../../generated/prisma';
import type { AuthRequest } from '../middlewares/auth.middleware';
import prisma from '../prisma';
import type { CreateScheduleBlockInput, ScheduleBlockTypeInput } from '../dtos/schedule.dto';
import { parseRequestedStart } from '../utils/scheduling';

const MINIMUM_BLOCK_MINUTES = 5;

function responseError(res: Response, status: number, code: string, message: string) {
  return res.status(status).json({ error: code, message });
}

async function ownDoctorId(req: AuthRequest): Promise<string | null> {
  if (req.user?.role !== 'DOCTOR') return null;
  const doctor = await prisma.doctorProfile.findUnique({ where: { userId: req.user.id }, select: { id: true } });
  return doctor?.id ?? null;
}

async function canManage(req: AuthRequest, doctorId: string, clinicId?: string | null) {
  if (!req.user) return false;
  if (req.user.role === 'SUPER_ADMIN') return true;
  const doctor = await prisma.doctorProfile.findUnique({ where: { id: doctorId } });
  if (!doctor) return false;
  if (req.user.role === 'DOCTOR') return doctor.userId === req.user.id;
  if (req.user.role === 'CLINIC_ADMIN') {
    const clinic = await prisma.clinicProfile.findUnique({ where: { userId: req.user.id } });
    return !!clinic && clinic.id === clinicId && !!await prisma.doctorClinicWorkplace.findFirst({
      where: { doctorProfileId: doctorId, clinicProfileId: clinic.id, isActive: true },
    });
  }
  if (req.user.role === 'ASSISTANT') {
    const assistant = await prisma.assistantProfile.findUnique({ where: { userId: req.user.id } });
    return !!assistant && (
      assistant.doctorProfileId === doctorId
      || (
        !!clinicId
        && assistant.clinicProfileId === clinicId
        && !!await prisma.doctorClinicWorkplace.findFirst({
          where: { doctorProfileId: doctorId, clinicProfileId: clinicId, isActive: true },
        })
      )
    );
  }
  return false;
}

async function validateDoctorClinic(doctorId: string, clinicId: string | null) {
  if (!clinicId) return 'OK' as const;
  const clinic = await prisma.clinicProfile.findUnique({ where: { id: clinicId }, select: { id: true } });
  if (!clinic) return 'NOT_FOUND' as const;
  const workplace = await prisma.doctorClinicWorkplace.findUnique({
    where: { doctorProfileId_clinicProfileId: { doctorProfileId: doctorId, clinicProfileId: clinicId } },
  });
  return workplace?.isActive ? 'OK' as const : 'NOT_LINKED' as const;
}

function parseOptionalRange(value: unknown): Date | null {
  if (value === undefined) return null;
  return parseRequestedStart(value);
}

export async function createScheduleBlock(req: AuthRequest, res: Response) {
  const input = req.body as Partial<CreateScheduleBlockInput>;
  const derivedDoctorId = await ownDoctorId(req);
  const doctorId = req.user?.role === 'DOCTOR' ? derivedDoctorId : (typeof input.doctorId === 'string' ? input.doctorId : null);
  if (!doctorId) return responseError(res, 404, 'DOCTOR_PROFILE_NOT_FOUND', 'No existe un perfil médico válido.');
  const clinicId = typeof input.clinicId === 'string' && input.clinicId.trim() ? input.clinicId.trim() : null;
  const type: ScheduleBlockTypeInput = input.type === 'PERSONAL' ? 'PERSONAL' : input.type === 'BLOCK' || input.type === undefined ? 'BLOCK' : input.type;
  if (type !== 'BLOCK' && type !== 'PERSONAL') {
    return responseError(res, 400, 'INVALID_BLOCK_TYPE', 'El tipo debe ser BLOCK o PERSONAL.');
  }

  let start: Date;
  let end: Date;
  try {
    start = parseRequestedStart(input.startsAt);
    end = parseRequestedStart(input.endsAt);
  } catch {
    return responseError(res, 400, 'INVALID_BLOCK', 'La fecha y hora indicadas no son válidas.');
  }
  if (end <= start || start <= new Date() || end.getTime() - start.getTime() < MINIMUM_BLOCK_MINUTES * 60_000) {
    return responseError(res, 400, 'INVALID_INTERVAL', `El intervalo debe ser futuro, terminar después de iniciar y durar al menos ${MINIMUM_BLOCK_MINUTES} minutos.`);
  }
  if (!await canManage(req, doctorId, clinicId)) {
    return responseError(res, 403, 'FORBIDDEN', 'No tienes permisos para administrar la agenda de este médico.');
  }
  const clinicState = await validateDoctorClinic(doctorId, clinicId);
  if (clinicState === 'NOT_FOUND') return responseError(res, 404, 'CLINIC_NOT_FOUND', 'La clínica indicada no existe.');
  if (clinicState === 'NOT_LINKED') return responseError(res, 403, 'CLINIC_NOT_LINKED', 'La clínica no está vinculada activamente al médico.');

  try {
    const block = await prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${doctorId}))`;
      const occupied = await tx.appointment.findFirst({
        where: {
          doctorProfileId: doctorId,
          status: { in: ['PENDING', 'CONFIRMED', 'IN_PROGRESS'] },
          startsAt: { lt: end },
          endsAt: { gt: start },
        },
      });
      const overlap = await tx.scheduleBlock.findFirst({
        where: { doctorProfileId: doctorId, startsAt: { lt: end }, endsAt: { gt: start } },
      });
      if (occupied || overlap) throw new Error('CONFLICT');
      return tx.scheduleBlock.create({
        data: {
          doctorProfileId: doctorId,
          clinicProfileId: clinicId,
          startsAt: start,
          endsAt: end,
          type,
          reason: typeof input.reason === 'string' && input.reason.trim() ? input.reason.trim().slice(0, 500) : null,
          createdByUserId: req.user!.id,
        },
      });
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
    return res.status(201).json(block);
  } catch (caught) {
    const conflict = (caught instanceof Prisma.PrismaClientKnownRequestError && caught.code === 'P2034')
      || (caught instanceof Error && (
        caught.message === 'CONFLICT'
        || caught.message.includes('ScheduleBlock_no_doctor_overlap')
        || caught.message.includes('23P01')
      ));
    if (conflict) return responseError(res, 409, 'APPOINTMENT_TIME_CONFLICT', 'El intervalo ya está ocupado.');
    console.error('[Schedule block create]', caught);
    return responseError(res, 500, 'INTERNAL_ERROR', 'No se pudo crear el bloqueo.');
  }
}

export async function listScheduleBlocks(req: AuthRequest, res: Response) {
  const derivedDoctorId = await ownDoctorId(req);
  const doctorId = req.user?.role === 'DOCTOR' ? derivedDoctorId : (typeof req.query.doctorId === 'string' ? req.query.doctorId : null);
  if (!doctorId) return responseError(res, 400, 'INVALID_INPUT', 'Indica un médico válido.');
  const clinicId = typeof req.query.clinicId === 'string' && req.query.clinicId.trim() ? req.query.clinicId.trim() : null;
  if (!await canManage(req, doctorId, clinicId)) return responseError(res, 403, 'FORBIDDEN', 'No tienes permisos para consultar esta agenda.');
  const clinicState = await validateDoctorClinic(doctorId, clinicId);
  if (clinicState === 'NOT_FOUND') return responseError(res, 404, 'CLINIC_NOT_FOUND', 'La clínica indicada no existe.');
  if (clinicState === 'NOT_LINKED') return responseError(res, 403, 'CLINIC_NOT_LINKED', 'La clínica no está vinculada activamente al médico.');

  let rangeStart: Date | null;
  let rangeEnd: Date | null;
  try {
    rangeStart = parseOptionalRange(req.query.rangeStart);
    rangeEnd = parseOptionalRange(req.query.rangeEnd);
  } catch {
    return responseError(res, 400, 'INVALID_RANGE', 'El rango de fechas no es válido.');
  }
  if ((rangeStart && !rangeEnd) || (!rangeStart && rangeEnd) || (rangeStart && rangeEnd && rangeEnd <= rangeStart)) {
    return responseError(res, 400, 'INVALID_RANGE', 'El rango debe incluir un inicio y un fin válidos.');
  }
  const blocks = await prisma.scheduleBlock.findMany({
    where: {
      doctorProfileId: doctorId,
      ...(clinicId ? { OR: [{ clinicProfileId: clinicId }, { clinicProfileId: null }] } : {}),
      ...(rangeStart && rangeEnd ? { startsAt: { lt: rangeEnd }, endsAt: { gt: rangeStart } } : {}),
    },
    orderBy: { startsAt: 'asc' },
  });
  return res.json({ items: blocks });
}

export async function deleteScheduleBlock(req: AuthRequest, res: Response) {
  const block = await prisma.scheduleBlock.findUnique({ where: { id: String(req.params.id) } });
  if (!block) return responseError(res, 404, 'NOT_FOUND', 'El bloqueo no existe.');
  if (!await canManage(req, block.doctorProfileId, block.clinicProfileId)) {
    return responseError(res, 403, 'FORBIDDEN', 'No tienes permisos para eliminar este bloqueo.');
  }
  await prisma.scheduleBlock.delete({ where: { id: block.id } });
  return res.status(204).send();
}
