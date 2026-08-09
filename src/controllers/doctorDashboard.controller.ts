import type { Response } from 'express';
import type { AuthRequest } from '../middlewares/auth.middleware';
import prisma from '../prisma';
import { activeScheduleBlockWhere } from '../domain/scheduleBlockState';
import { APP_TIMEZONE, localDate, localDateTimeToUtc } from '../utils/scheduling';

function fail(res: Response, status: number, error: string, message: string) { return res.status(status).json({ error, message }); }

export async function getMyDoctorDashboardSummary(req: AuthRequest, res: Response) {
  const doctor = await prisma.doctorProfile.findUnique({ where: { userId: req.user!.id }, select: { id: true } });
  if (!doctor) return fail(res, 404, 'DOCTOR_PROFILE_NOT_FOUND', 'No existe un perfil médico para esta sesión.');
  const clinicId = typeof req.query.clinicId === 'string' ? req.query.clinicId.trim() : '';
  let clinicName: string | null = null;
  if (clinicId) {
    const workplace = await prisma.doctorClinicWorkplace.findUnique({ where: { doctorProfileId_clinicProfileId: { doctorProfileId: doctor.id, clinicProfileId: clinicId } }, select: { isActive: true, clinicProfile: { select: { name: true } } } });
    if (!workplace?.isActive) return fail(res, 403, 'CLINIC_NOT_LINKED', 'La sede no está vinculada activamente a tu perfil.');
    clinicName = workplace.clinicProfile.name;
  }
  const dateKey = localDate(new Date());
  const dayStart = localDateTimeToUtc(dateKey, '00:00');
  const dayEnd = new Date(dayStart.getTime() + 86_400_000);
  const appointmentScope = { doctorProfileId: doctor.id, ...(clinicId ? { clinicProfileId: clinicId } : {}) };
  const [todayAppointments, nextAppointment, payments, blocks, unreadCount] = await Promise.all([
    prisma.appointment.findMany({ where: { ...appointmentScope, startsAt: { gte: dayStart, lt: dayEnd } }, select: { status: true } }),
    prisma.appointment.findFirst({ where: { ...appointmentScope, startsAt: { gte: new Date() }, status: { in: ['PENDING', 'CONFIRMED', 'IN_PROGRESS'] } }, orderBy: { startsAt: 'asc' }, select: { id: true, startsAt: true, status: true, serviceNameSnapshot: true, invitedPatientFirstName: true, invitedPatientLastName: true, patient: { select: { firstName: true, lastName: true } }, service: { select: { name: true } }, clinicProfile: { select: { name: true } } } }),
    prisma.payment.findMany({ where: { method: 'CASH', appointment: { ...appointmentScope, startsAt: { gte: dayStart, lt: dayEnd } } }, select: { status: true, amountCents: true } }),
    prisma.scheduleBlock.findMany({ where: activeScheduleBlockWhere({ doctorProfileId: doctor.id, ...(clinicId ? { OR: [{ clinicProfileId: clinicId }, { clinicProfileId: null }] } : {}), startsAt: { lt: dayEnd }, endsAt: { gt: dayStart } }), select: { startsAt: true, endsAt: true } }),
    prisma.userNotification.count({ where: { userId: req.user!.id, readAt: null } }),
  ]);
  const count = (status: string) => todayAppointments.filter((appointment) => appointment.status === status).length;
  const patientDisplayName = nextAppointment?.patient
    ? `${nextAppointment.patient.firstName} ${nextAppointment.patient.lastName}`.trim()
    : `${nextAppointment?.invitedPatientFirstName ?? ''} ${nextAppointment?.invitedPatientLastName ?? ''}`.trim() || 'Paciente invitado';
  return res.json({
    timezone: APP_TIMEZONE,
    workspace: { selectedClinicId: clinicId || null, label: clinicName || 'Todas mis sedes' },
    today: { total: todayAppointments.length, pending: count('PENDING'), confirmed: count('CONFIRMED'), completed: count('COMPLETED'), missed: count('MISSED') },
    nextAppointment: nextAppointment ? { id: nextAppointment.id, startsAt: nextAppointment.startsAt?.toISOString() ?? null, patientDisplayName, serviceName: nextAppointment.serviceNameSnapshot || nextAppointment.service.name, clinicName: nextAppointment.clinicProfile.name, status: nextAppointment.status } : null,
    finance: {
      confirmedRevenueCents: payments.filter((payment) => payment.status === 'CONFIRMED').reduce((sum, payment) => sum + payment.amountCents, 0),
      pendingRevenueCents: payments.filter((payment) => payment.status === 'PENDING').reduce((sum, payment) => sum + payment.amountCents, 0),
      pendingCashPayments: payments.filter((payment) => payment.status === 'PENDING').length,
    },
    schedule: { blockedMinutes: blocks.reduce((sum, block) => sum + Math.max(0, Math.min(block.endsAt.getTime(), dayEnd.getTime()) - Math.max(block.startsAt.getTime(), dayStart.getTime())) / 60_000, 0) },
    notifications: { unreadCount },
  });
}
