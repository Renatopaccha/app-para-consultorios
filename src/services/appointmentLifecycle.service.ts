import { Prisma, Role } from '../../generated/prisma';
import prisma from '../prisma';
import { BookingError } from './appointmentBooking.service';
import { localDate } from '../utils/scheduling';

type Actor = { id: string; role: Role };
async function canManage(appointment: { patientId: string; doctorProfileId: string; clinicProfileId: string }, actor: Actor, patientAllowed: boolean) {
  if (actor.role === 'SUPER_ADMIN') return true;
  if (actor.role === 'PATIENT') return patientAllowed && appointment.patientId === actor.id;
  if (actor.role === 'DOCTOR') return (await prisma.doctorProfile.findUnique({ where: { id: appointment.doctorProfileId } }))?.userId === actor.id;
  if (actor.role === 'CLINIC_ADMIN') return (await prisma.clinicProfile.findUnique({ where: { id: appointment.clinicProfileId } }))?.userId === actor.id;
  if (actor.role === 'ASSISTANT') { const a = await prisma.assistantProfile.findUnique({ where: { userId: actor.id } }); return a?.doctorProfileId === appointment.doctorProfileId || a?.clinicProfileId === appointment.clinicProfileId; }
  return false;
}
async function loadAuthorized(id: string, actor: Actor, patientAllowed = false) {
  const appointment = await prisma.appointment.findUnique({ where: { id }, include: { turn: true } });
  if (!appointment) throw new BookingError('APPOINTMENT_NOT_FOUND', 404, 'Cita no encontrada.');
  if (!await canManage(appointment, actor, patientAllowed)) throw new BookingError('FORBIDDEN', 403, 'No tienes permisos.');
  return appointment;
}
export async function getOrCreateAppointmentTurn(appointmentId: string, actor: Actor) {
  const appointment = await loadAuthorized(appointmentId, actor, true);
  if (appointment.turn) return appointment.turn;
  if (!appointment.startsAt) throw new BookingError('INVALID_APPOINTMENT_TIME', 422, 'La cita no tiene horario canónico.');
  const day = localDate(appointment.startsAt); const lockKey = `${appointment.doctorProfileId}:${appointment.clinicProfileId}:${day}`;
  try { return await prisma.$transaction(async tx => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${lockKey}))`;
    const existing = await tx.appointmentTurn.findUnique({ where: { appointmentId } }); if (existing) return existing;
    const last = await tx.appointmentTurn.aggregate({ where: { doctorProfileId: appointment.doctorProfileId, clinicProfileId: appointment.clinicProfileId, localDate: day }, _max: { turnNumber: true, queueOrder: true } });
    return tx.appointmentTurn.create({ data: { appointmentId, doctorProfileId: appointment.doctorProfileId, clinicProfileId: appointment.clinicProfileId, localDate: day, turnNumber: (last._max.turnNumber || 0) + 1, queueOrder: (last._max.queueOrder || 0) + 1 } });
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable }); } catch (error) { if (error instanceof Prisma.PrismaClientKnownRequestError && ['P2002','P2034'].includes(error.code)) return prisma.appointmentTurn.findUniqueOrThrow({ where: { appointmentId } }); throw error; }
}
export async function checkInAppointment(id: string, actor: Actor) { const a = await loadAuthorized(id, actor, true); if (['CANCELLED','COMPLETED','MISSED'].includes(a.status)) throw new BookingError('CHECK_IN_NOT_ALLOWED', 422, 'Check-in no permitido.'); const turn = await getOrCreateAppointmentTurn(id, actor); const updated = await prisma.$transaction(async tx => { const appt = await tx.appointment.update({ where: { id }, data: { checkedInAt: a.checkedInAt || new Date() } }); if (!a.checkedInAt) await tx.appointmentChangeLog.create({ data: { appointmentId: id, changedByUserId: actor.id, changeType: 'STATUS_CHANGED', previousStatus: a.status, newStatus: a.status, reason: 'CHECKED_IN' } }); return appt; }); return { appointment: updated, turn }; }
export async function startAppointment(id: string, actor: Actor) { const a = await loadAuthorized(id, actor); if (['CANCELLED','COMPLETED','MISSED'].includes(a.status) || (!a.checkedInAt && a.patientConfirmationStatus !== 'CONFIRMED')) throw new BookingError('START_NOT_ALLOWED', 422, 'No se puede iniciar.'); return prisma.$transaction(async tx => { const now = new Date(); const updated = await tx.appointment.update({ where: { id }, data: { status: 'IN_PROGRESS', startedAt: now } }); await tx.appointmentTurn.updateMany({ where: { appointmentId: id }, data: { status: 'IN_PROGRESS', startedAt: now } }); await tx.appointmentChangeLog.create({ data: { appointmentId: id, changedByUserId: actor.id, changeType: 'STATUS_CHANGED', previousStatus: a.status, newStatus: 'IN_PROGRESS', reason: 'ATTENTION_STARTED' } }); return updated; }); }
export async function completeAppointment(id: string, actor: Actor) { const a = await loadAuthorized(id, actor); if (a.status !== 'IN_PROGRESS') throw new BookingError('COMPLETE_NOT_ALLOWED', 422, 'Solo una cita en atención puede completarse.'); return prisma.$transaction(async tx => { const now = new Date(); const updated = await tx.appointment.update({ where: { id }, data: { status: 'COMPLETED', completedAt: now } }); await tx.appointmentTurn.updateMany({ where: { appointmentId: id }, data: { status: 'COMPLETED', completedAt: now } }); await tx.appointmentChangeLog.create({ data: { appointmentId: id, changedByUserId: actor.id, changeType: 'STATUS_CHANGED', previousStatus: a.status, newStatus: 'COMPLETED', reason: 'ATTENTION_COMPLETED' } }); return updated; }); }
export async function markAppointmentNoShow(id: string, actor: Actor) { const a = await loadAuthorized(id, actor); if (['CANCELLED','COMPLETED'].includes(a.status)) throw new BookingError('NO_SHOW_NOT_ALLOWED', 422, 'No-show no permitido.'); return prisma.$transaction(async tx => { const now = new Date(); const updated = await tx.appointment.update({ where: { id }, data: { status: 'MISSED', noShowAt: now } }); await tx.appointmentTurn.updateMany({ where: { appointmentId: id }, data: { status: 'MISSED' } }); await tx.appointmentChangeLog.create({ data: { appointmentId: id, changedByUserId: actor.id, changeType: 'STATUS_CHANGED', previousStatus: a.status, newStatus: 'MISSED', reason: 'NO_SHOW' } }); return updated; }); }
async function authorizedTurn(id: string, actor: Actor) { const turn = await prisma.appointmentTurn.findUnique({ where: { id }, include: { appointment: true } }); if (!turn) throw new BookingError('TURN_NOT_FOUND', 404, 'Turno no encontrado.'); if (!await canManage(turn.appointment, actor, false)) throw new BookingError('FORBIDDEN', 403, 'No tienes permisos.'); return turn; }
export async function callTurn(id: string, actor: Actor) { await authorizedTurn(id, actor); return prisma.appointmentTurn.update({ where: { id }, data: { status: 'CALLED', calledAt: new Date() } }); }
export async function delayTurn(id: string, actor: Actor) { const t = await authorizedTurn(id, actor); const max = await prisma.appointmentTurn.aggregate({ where: { doctorProfileId: t.doctorProfileId, clinicProfileId: t.clinicProfileId, localDate: t.localDate, status: { in: ['WAITING','CALLED','DELAYED'] } }, _max: { queueOrder: true } }); return prisma.appointmentTurn.update({ where: { id }, data: { status: 'DELAYED', delayedAt: new Date(), queueOrder: (max._max.queueOrder || 0) + 1 } }); }
export async function completeTurn(id: string, actor: Actor) { await authorizedTurn(id, actor); return prisma.appointmentTurn.update({ where: { id }, data: { status: 'COMPLETED', completedAt: new Date() } }); }
export async function getTodayTurns(actor: Actor) { const doctor = actor.role === 'DOCTOR' ? await prisma.doctorProfile.findUnique({ where: { userId: actor.id } }) : null; return prisma.appointmentTurn.findMany({ where: doctor ? { doctorProfileId: doctor.id } : {}, orderBy: [{ localDate: 'asc' }, { queueOrder: 'asc' }] }); }
