import type { Response } from 'express';
import { Prisma } from '../../generated/prisma';
import type { AuthRequest } from '../middlewares/auth.middleware';
import prisma from '../prisma';
import type { CreateScheduleBlockInput, OperationalBlockPublicLabel, ScheduleBlockTypeInput, ScheduleBlockVisibilityInput, UpdateScheduleBlockInput } from '../dtos/schedule.dto';
import { parseRequestedStart } from '../utils/scheduling';
import { ACTIVE_SCHEDULE_BLOCK_WHERE, activeScheduleBlockWhere } from '../domain/scheduleBlockState';

const MINIMUM_BLOCK_MINUTES = 5;
const PUBLIC_LABELS = new Set<OperationalBlockPublicLabel>(['LUNCH', 'VACATION', 'PROFESSIONAL_DUTY', 'MAINTENANCE']);

function responseError(res: Response, status: number, code: string, message: string) { return res.status(status).json({ error: code, message }); }
function scheduleConflict(res: Response, conflictType: 'SCHEDULE_BLOCK' | 'APPOINTMENT') {
  return res.status(409).json({ success: false, error: { code: 'SCHEDULE_CONFLICT', message: 'El intervalo se superpone con otro elemento activo', conflictType } });
}
function trimText(value: unknown, max: number): string | null | undefined {
  if (value === undefined) return undefined;
  if (value === null) return null;
  return typeof value === 'string' ? (value.trim().slice(0, max) || null) : undefined;
}
function validLabel(value: unknown): value is OperationalBlockPublicLabel { return typeof value === 'string' && PUBLIC_LABELS.has(value as OperationalBlockPublicLabel); }
function snapshot(block: { startsAt: Date; endsAt: Date; clinicProfileId: string | null; type: string; visibility: string; publicLabel: string | null; privateTitle: string | null; internalNotes: string | null; deletedAt: Date | null }) {
  return { startsAt: block.startsAt.toISOString(), endsAt: block.endsAt.toISOString(), clinicId: block.clinicProfileId, type: block.type, visibility: block.visibility, publicLabel: block.publicLabel, privateTitle: block.privateTitle, internalNotes: block.internalNotes, deletedAt: block.deletedAt?.toISOString() ?? null };
}
type PresentableBlock = { id: string; doctorProfileId: string; clinicProfileId: string | null; startsAt: Date; endsAt: Date; type: string; visibility: string; publicLabel: string | null; privateTitle: string | null; internalNotes: string | null; reason: string | null; createdAt: Date; updatedAt: Date };
function present(block: PresentableBlock, includePrivate: boolean) {
  const base = { id: block.id, doctorProfileId: block.doctorProfileId, clinicProfileId: block.clinicProfileId, startsAt: block.startsAt, endsAt: block.endsAt, type: block.type, visibility: block.visibility, publicLabel: block.visibility === 'PUBLIC_LABEL' ? block.publicLabel : null, createdAt: block.createdAt, updatedAt: block.updatedAt };
  return includePrivate ? { ...base, privateTitle: block.privateTitle ?? block.reason, internalNotes: block.internalNotes, reason: block.privateTitle ?? block.reason } : base;
}

async function ownDoctorId(req: AuthRequest): Promise<string | null> {
  if (req.user?.role !== 'DOCTOR') return null;
  return (await prisma.doctorProfile.findUnique({ where: { userId: req.user.id }, select: { id: true } }))?.id ?? null;
}
async function canManage(req: AuthRequest, doctorId: string, clinicId?: string | null) {
  if (!req.user) return false;
  if (req.user.role === 'SUPER_ADMIN') return true;
  const doctor = await prisma.doctorProfile.findUnique({ where: { id: doctorId } }); if (!doctor) return false;
  if (req.user.role === 'DOCTOR') return doctor.userId === req.user.id;
  if (req.user.role === 'CLINIC_ADMIN') {
    const clinic = await prisma.clinicProfile.findUnique({ where: { userId: req.user.id } });
    return !!clinic && clinic.id === clinicId && !!await prisma.doctorClinicWorkplace.findFirst({ where: { doctorProfileId: doctorId, clinicProfileId: clinic.id, isActive: true } });
  }
  if (req.user.role === 'ASSISTANT') {
    const assistant = await prisma.assistantProfile.findUnique({ where: { userId: req.user.id } });
    return !!assistant && (assistant.doctorProfileId === doctorId || (!!clinicId && assistant.clinicProfileId === clinicId && !!await prisma.doctorClinicWorkplace.findFirst({ where: { doctorProfileId: doctorId, clinicProfileId: clinicId, isActive: true } })));
  }
  return false;
}
async function validateDoctorClinic(doctorId: string, clinicId: string | null) {
  if (!clinicId) return 'OK' as const;
  if (!await prisma.clinicProfile.findUnique({ where: { id: clinicId }, select: { id: true } })) return 'NOT_FOUND' as const;
  return (await prisma.doctorClinicWorkplace.findUnique({ where: { doctorProfileId_clinicProfileId: { doctorProfileId: doctorId, clinicProfileId: clinicId } } }))?.isActive ? 'OK' : 'NOT_LINKED';
}
function parseRange(value: unknown): Date | null { return value === undefined ? null : parseRequestedStart(value); }
type PrivacySource = { visibility: string; publicLabel: string | null; privateTitle: string | null; internalNotes: string | null };
function parsePrivacy(input: Partial<CreateScheduleBlockInput | UpdateScheduleBlockInput>, type: ScheduleBlockTypeInput, current?: PrivacySource) {
  const visibility = input.visibility === undefined ? (current?.visibility ?? 'PRIVATE') : input.visibility;
  if (visibility !== 'PRIVATE' && visibility !== 'PUBLIC_LABEL') throw new Error('INVALID_VISIBILITY');
  const publicLabelInput = input.publicLabel === undefined ? (current?.publicLabel ?? null) : input.publicLabel;
  if (visibility === 'PUBLIC_LABEL' && type === 'PERSONAL') throw new Error('PERSONAL_BLOCK_PRIVATE');
  if (visibility === 'PUBLIC_LABEL' && !validLabel(publicLabelInput)) throw new Error('INVALID_PUBLIC_LABEL');
  const title = trimText(input.privateTitle ?? input.reason, 160);
  const notes = trimText(input.internalNotes, 1000);
  return { visibility: visibility as ScheduleBlockVisibilityInput, publicLabel: visibility === 'PUBLIC_LABEL' ? publicLabelInput as string : null, privateTitle: title === undefined ? (current?.privateTitle ?? null) : title, internalNotes: notes === undefined ? (current?.internalNotes ?? null) : notes };
}
class ActiveScheduleConflict extends Error { constructor(readonly conflictType: 'SCHEDULE_BLOCK' | 'APPOINTMENT') { super('ACTIVE_SCHEDULE_CONFLICT'); } }
function conflictError(caught: unknown) { return (caught instanceof Prisma.PrismaClientKnownRequestError && caught.code === 'P2034') || (caught instanceof Error && (caught.message.includes('23P01') || caught.message.includes('ScheduleBlock_no_doctor_overlap'))); }
async function ensureNoOverlap(tx: Prisma.TransactionClient, doctorId: string, startsAt: Date, endsAt: Date, excludedId?: string) {
  const [appointment, block] = await Promise.all([
    tx.appointment.findFirst({ where: { doctorProfileId: doctorId, status: { in: ['PENDING', 'CONFIRMED', 'IN_PROGRESS'] }, startsAt: { lt: endsAt }, endsAt: { gt: startsAt } } }),
    tx.scheduleBlock.findFirst({ where: activeScheduleBlockWhere({ doctorProfileId: doctorId, ...(excludedId ? { id: { not: excludedId } } : {}), startsAt: { lt: endsAt }, endsAt: { gt: startsAt } }) }),
  ]);
  if (appointment) throw new ActiveScheduleConflict('APPOINTMENT');
  if (block) throw new ActiveScheduleConflict('SCHEDULE_BLOCK');
}

export async function createScheduleBlock(req: AuthRequest, res: Response) {
  const input = req.body as Partial<CreateScheduleBlockInput>; const ownId = await ownDoctorId(req);
  const doctorId = req.user?.role === 'DOCTOR' ? ownId : (typeof input.doctorId === 'string' ? input.doctorId : null);
  if (!doctorId) return responseError(res, 404, 'DOCTOR_PROFILE_NOT_FOUND', 'No existe un perfil médico válido.');
  const clinicId = typeof input.clinicId === 'string' && input.clinicId.trim() ? input.clinicId.trim() : null;
  const type: ScheduleBlockTypeInput = input.type === 'PERSONAL' ? 'PERSONAL' : input.type === 'BLOCK' || input.type === undefined ? 'BLOCK' : input.type;
  if (type !== 'BLOCK' && type !== 'PERSONAL') return responseError(res, 400, 'INVALID_BLOCK_TYPE', 'El tipo debe ser BLOCK o PERSONAL.');
  let startsAt: Date; let endsAt: Date; let privacy: ReturnType<typeof parsePrivacy>;
  try { startsAt = parseRequestedStart(input.startsAt); endsAt = parseRequestedStart(input.endsAt); privacy = parsePrivacy(input, type); } catch (error) { return responseError(res, 400, error instanceof Error ? error.message : 'INVALID_BLOCK', 'Los datos del bloqueo no son válidos.'); }
  if (endsAt <= startsAt || startsAt <= new Date() || endsAt.getTime() - startsAt.getTime() < MINIMUM_BLOCK_MINUTES * 60_000) return responseError(res, 400, 'INVALID_INTERVAL', `El intervalo debe ser futuro, terminar después de iniciar y durar al menos ${MINIMUM_BLOCK_MINUTES} minutos.`);
  if (!await canManage(req, doctorId, clinicId)) return responseError(res, 403, 'FORBIDDEN', 'No tienes permisos para administrar la agenda de este médico.');
  const clinicState = await validateDoctorClinic(doctorId, clinicId); if (clinicState === 'NOT_FOUND') return responseError(res, 404, 'CLINIC_NOT_FOUND', 'La clínica indicada no existe.'); if (clinicState === 'NOT_LINKED') return responseError(res, 403, 'CLINIC_NOT_LINKED', 'La clínica no está vinculada activamente al médico.');
  try {
    const block = await prisma.$transaction(async tx => { await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${doctorId}))`; await ensureNoOverlap(tx, doctorId, startsAt, endsAt); const created = await tx.scheduleBlock.create({ data: { doctorProfileId: doctorId, clinicProfileId: clinicId, startsAt, endsAt, type, ...privacy, reason: privacy.privateTitle, createdByUserId: req.user!.id, updatedByUserId: req.user!.id } }); await tx.scheduleBlockChangeLog.create({ data: { scheduleBlockId: created.id, changedByUserId: req.user!.id, changeType: 'CREATED', newValue: snapshot(created) } }); return created; }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
    return res.status(201).json(present(block, true));
  } catch (error) { if (error instanceof ActiveScheduleConflict) return scheduleConflict(res, error.conflictType); if (conflictError(error)) return scheduleConflict(res, 'SCHEDULE_BLOCK'); console.error('[Schedule block create]', error); return responseError(res, 500, 'INTERNAL_ERROR', 'No se pudo crear el bloqueo.'); }
}

export async function listScheduleBlocks(req: AuthRequest, res: Response) {
  const ownId = await ownDoctorId(req); const doctorId = req.user?.role === 'DOCTOR' ? ownId : (typeof req.query.doctorId === 'string' ? req.query.doctorId : null);
  if (!doctorId) return responseError(res, 400, 'INVALID_INPUT', 'Indica un médico válido.'); const clinicId = typeof req.query.clinicId === 'string' && req.query.clinicId.trim() ? req.query.clinicId.trim() : null;
  if (!await canManage(req, doctorId, clinicId)) return responseError(res, 403, 'FORBIDDEN', 'No tienes permisos para consultar esta agenda.');
  let rangeStart: Date | null; let rangeEnd: Date | null; try { rangeStart = parseRange(req.query.rangeStart); rangeEnd = parseRange(req.query.rangeEnd); } catch { return responseError(res, 400, 'INVALID_RANGE', 'El rango de fechas no es válido.'); }
  if ((rangeStart && !rangeEnd) || (!rangeStart && rangeEnd) || (rangeStart && rangeEnd && rangeEnd <= rangeStart)) return responseError(res, 400, 'INVALID_RANGE', 'El rango debe incluir un inicio y un fin válidos.');
  const blocks = await prisma.scheduleBlock.findMany({ where: activeScheduleBlockWhere({ doctorProfileId: doctorId, ...(clinicId ? { OR: [{ clinicProfileId: clinicId }, { clinicProfileId: null }] } : {}), ...(rangeStart && rangeEnd ? { startsAt: { lt: rangeEnd }, endsAt: { gt: rangeStart } } : {}) }), orderBy: { startsAt: 'asc' } });
  const includePrivate = req.user?.role === 'SUPER_ADMIN' || (req.user?.role === 'DOCTOR' && !!ownId && ownId === doctorId);
  return res.json({ items: blocks.map(block => present(block, includePrivate)) });
}

export async function updateScheduleBlock(req: AuthRequest, res: Response) {
  const block = await prisma.scheduleBlock.findFirst({ where: activeScheduleBlockWhere({ id: String(req.params.id) }) }); if (!block) return responseError(res, 404, 'NOT_FOUND', 'El bloqueo no existe.');
  const doctorId = await ownDoctorId(req); if (!doctorId || doctorId !== block.doctorProfileId) return responseError(res, 403, 'FORBIDDEN', 'Solo el médico propietario puede editar este bloqueo.');
  const input = req.body as Partial<UpdateScheduleBlockInput>; const type = input.type === undefined ? block.type : input.type;
  if (type !== 'BLOCK' && type !== 'PERSONAL') return responseError(res, 400, 'INVALID_BLOCK_TYPE', 'El tipo debe ser BLOCK o PERSONAL.');
  let startsAt: Date; let endsAt: Date; let privacy: ReturnType<typeof parsePrivacy>; try { startsAt = input.startsAt === undefined ? block.startsAt : parseRequestedStart(input.startsAt); endsAt = input.endsAt === undefined ? block.endsAt : parseRequestedStart(input.endsAt); privacy = parsePrivacy(input, type, block); } catch (error) { return responseError(res, 400, error instanceof Error ? error.message : 'INVALID_BLOCK', 'Los datos del bloqueo no son válidos.'); }
  if (endsAt <= startsAt || startsAt <= new Date() || endsAt.getTime() - startsAt.getTime() < MINIMUM_BLOCK_MINUTES * 60_000) return responseError(res, 400, 'INVALID_INTERVAL', 'El intervalo debe ser futuro y válido.');
  const clinicId = input.clinicId === undefined ? block.clinicProfileId : (typeof input.clinicId === 'string' && input.clinicId.trim() ? input.clinicId.trim() : null); const clinicState = await validateDoctorClinic(doctorId, clinicId); if (clinicState !== 'OK') return responseError(res, clinicState === 'NOT_FOUND' ? 404 : 403, clinicState === 'NOT_FOUND' ? 'CLINIC_NOT_FOUND' : 'CLINIC_NOT_LINKED', 'La clínica no es válida para este médico.');
  let expected: Date | undefined;
  if (input.expectedUpdatedAt) {
    if (typeof input.expectedUpdatedAt !== 'string') return responseError(res, 400, 'INVALID_EXPECTED_UPDATED_AT', 'La versión del bloqueo no es válida.');
    expected = new Date(input.expectedUpdatedAt);
    if (Number.isNaN(expected.getTime())) return responseError(res, 400, 'INVALID_EXPECTED_UPDATED_AT', 'La versión del bloqueo no es válida.');
  }
  try { const updated = await prisma.$transaction(async tx => { await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${doctorId}))`; await ensureNoOverlap(tx, doctorId, startsAt, endsAt, block.id); const changed = await tx.scheduleBlock.updateMany({ where: { id: block.id, ...ACTIVE_SCHEDULE_BLOCK_WHERE, ...(expected ? { updatedAt: expected } : {}) }, data: { startsAt, endsAt, clinicProfileId: clinicId, type, ...privacy, reason: privacy.privateTitle, updatedByUserId: req.user!.id } }); if (changed.count !== 1) throw new Error('STALE'); const value = await tx.scheduleBlock.findUniqueOrThrow({ where: { id: block.id } }); await tx.scheduleBlockChangeLog.create({ data: { scheduleBlockId: block.id, changedByUserId: req.user!.id, changeType: 'UPDATED', previousValue: snapshot(block), newValue: snapshot(value) } }); return value; }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable }); return res.json(present(updated, true)); } catch (error) { if (error instanceof Error && error.message === 'STALE') return responseError(res, 409, 'SCHEDULE_BLOCK_STALE', 'El bloqueo fue modificado por otra sesión.'); if (error instanceof ActiveScheduleConflict) return scheduleConflict(res, error.conflictType); if (conflictError(error)) return scheduleConflict(res, 'SCHEDULE_BLOCK'); console.error('[Schedule block update]', error); return responseError(res, 500, 'INTERNAL_ERROR', 'No se pudo actualizar el bloqueo.'); }
}

export async function deleteScheduleBlock(req: AuthRequest, res: Response) {
  const block = await prisma.scheduleBlock.findUnique({ where: { id: String(req.params.id) } }); if (!block) return responseError(res, 404, 'NOT_FOUND', 'El bloqueo no existe.'); const doctorId = await ownDoctorId(req); if (!doctorId || doctorId !== block.doctorProfileId) return responseError(res, 403, 'FORBIDDEN', 'Solo el médico propietario puede desbloquear este horario.');
  if (block.deletedAt) return responseError(res, 409, 'SCHEDULE_BLOCK_ALREADY_UNBLOCKED', 'El horario ya estaba desbloqueado.');
  try {
    const result = await prisma.$transaction(async tx => { await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${doctorId}))`; const changed = await tx.scheduleBlock.updateMany({ where: { id: block.id, ...ACTIVE_SCHEDULE_BLOCK_WHERE }, data: { deletedAt: new Date(), deletedByUserId: req.user!.id, updatedByUserId: req.user!.id } }); if (changed.count !== 1) throw new Error('ALREADY_UNBLOCKED'); const updated = await tx.scheduleBlock.findUniqueOrThrow({ where: { id: block.id } }); await tx.scheduleBlockChangeLog.create({ data: { scheduleBlockId: block.id, changedByUserId: req.user!.id, changeType: 'UNBLOCKED', previousValue: snapshot(block), newValue: snapshot(updated) } }); return updated; });
    return res.json(present(result, true));
  } catch (error) { if (error instanceof Error && error.message === 'ALREADY_UNBLOCKED') return responseError(res, 409, 'SCHEDULE_BLOCK_ALREADY_UNBLOCKED', 'El horario ya estaba desbloqueado.'); throw error; }
}
