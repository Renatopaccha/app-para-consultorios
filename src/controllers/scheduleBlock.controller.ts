import { Response } from 'express';
import { Prisma } from '../../generated/prisma';
import prisma from '../prisma';
import { AuthRequest } from '../middlewares/auth.middleware';
import { parseRequestedStart } from '../utils/scheduling';

async function canManage(req: AuthRequest, doctorId: string, clinicId?: string | null) {
  if (!req.user) return false;
  if (req.user.role === 'SUPER_ADMIN') return true;
  const doctor = await prisma.doctorProfile.findUnique({ where: { id: doctorId } });
  if (!doctor) return false;
  if (req.user.role === 'DOCTOR') return doctor.userId === req.user.id;
  if (req.user.role === 'CLINIC_ADMIN') {
    const clinic = await prisma.clinicProfile.findUnique({ where: { userId: req.user.id } });
    return !!clinic && clinic.id === clinicId && !!await prisma.doctorClinicWorkplace.findFirst({ where: { doctorProfileId: doctorId, clinicProfileId: clinic.id, isActive: true } });
  }
  if (req.user.role === 'ASSISTANT') {
    const assistant = await prisma.assistantProfile.findUnique({ where: { userId: req.user.id } });
    return !!assistant && (assistant.doctorProfileId === doctorId || (assistant.clinicProfileId === clinicId && !!await prisma.doctorClinicWorkplace.findFirst({ where: { doctorProfileId: doctorId, clinicProfileId: clinicId!, isActive: true } })));
  }
  return false;
}
export async function createScheduleBlock(req: AuthRequest, res: Response) {
  try { const { doctorId, clinicId, startsAt, endsAt, reason } = req.body; const start = parseRequestedStart(startsAt); const end = parseRequestedStart(endsAt); if (end <= start || start <= new Date()) return res.status(400).json({ error: 'INVALID_INTERVAL' }); if (!await canManage(req, doctorId, clinicId || null)) return res.status(403).json({ error: 'FORBIDDEN' }); const block = await prisma.$transaction(async tx => { await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${doctorId}))`; const occupied = await tx.appointment.findFirst({ where: { doctorProfileId: doctorId, status: { in: ['PENDING', 'CONFIRMED', 'IN_PROGRESS'] }, startsAt: { lt: end }, endsAt: { gt: start } } }); const overlap = await tx.scheduleBlock.findFirst({ where: { doctorProfileId: doctorId, startsAt: { lt: end }, endsAt: { gt: start } } }); if (occupied || overlap) throw new Error('CONFLICT'); return tx.scheduleBlock.create({ data: { doctorProfileId: doctorId, clinicProfileId: clinicId || null, startsAt: start, endsAt: end, reason: typeof reason === 'string' ? reason : null, createdByUserId: req.user!.id } }); }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable }); return res.status(201).json(block); } catch (error) { const conflict = (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2034') || (error instanceof Error && (error.message === 'CONFLICT' || error.message.includes('ScheduleBlock_no_doctor_overlap') || error.message.includes('23P01'))); return res.status(conflict ? 409 : 400).json({ error: conflict ? 'APPOINTMENT_TIME_CONFLICT' : 'INVALID_BLOCK' }); }
}
export async function listScheduleBlocks(req: AuthRequest, res: Response) { const doctorId = String(req.query.doctorId || ''); const clinicId = typeof req.query.clinicId === 'string' ? req.query.clinicId : null; if (!doctorId) return res.status(400).json({ error: 'INVALID_INPUT' }); if (!await canManage(req, doctorId, clinicId)) return res.status(403).json({ error: 'FORBIDDEN' }); return res.json(await prisma.scheduleBlock.findMany({ where: { doctorProfileId: doctorId, ...(clinicId ? { clinicProfileId: clinicId } : {}) }, orderBy: { startsAt: 'asc' } })); }
export async function deleteScheduleBlock(req: AuthRequest, res: Response) { const block = await prisma.scheduleBlock.findUnique({ where: { id: String(req.params.id) } }); if (!block) return res.status(404).json({ error: 'NOT_FOUND' }); if (!await canManage(req, block.doctorProfileId, block.clinicProfileId)) return res.status(403).json({ error: 'FORBIDDEN' }); await prisma.scheduleBlock.delete({ where: { id: block.id } }); return res.status(204).send(); }
