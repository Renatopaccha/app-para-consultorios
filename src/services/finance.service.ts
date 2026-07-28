import { Prisma } from '../../generated/prisma';
import prisma from '../prisma';
import { PaymentActor, paymentAppointmentScope } from './cashPaymentAuthorization.service';
import { cashAmountFromCents } from './cashPaymentCode.service';

const financeInclude = {
  appointment: { include: { patient: { select: { id: true, firstName: true, lastName: true } }, doctorProfile: { include: { user: { select: { firstName: true, lastName: true } } } }, clinicProfile: { select: { id: true, name: true } }, service: { select: { id: true, name: true } } } },
  confirmedBy: { select: { id: true, firstName: true, lastName: true } },
} satisfies Prisma.PaymentInclude;

type FinancePayment = Prisma.PaymentGetPayload<{ include: typeof financeInclude }>;

async function financeWhere(actor: PaymentActor, query: Record<string, string | undefined>): Promise<Prisma.PaymentWhereInput> {
  const scope = await paymentAppointmentScope(actor, true);
  const appointmentFilter: Prisma.AppointmentWhereInput = {};
  if (query.doctorId) appointmentFilter.doctorProfileId = query.doctorId;
  if (query.clinicId) appointmentFilter.clinicProfileId = query.clinicId;
  if (query.startDate || query.endDate) appointmentFilter.startsAt = { ...(query.startDate ? { gte: new Date(`${query.startDate}T00:00:00.000Z`) } : {}), ...(query.endDate ? { lte: new Date(`${query.endDate}T23:59:59.999Z`) } : {}) };
  const where: Prisma.PaymentWhereInput = { method: 'CASH', appointment: { AND: [scope, appointmentFilter] } };
  if (query.status && ['PENDING', 'CONFIRMED', 'CANCELLED', 'REFUNDED', 'EXEMPTED'].includes(query.status)) where.status = query.status as any;
  return where;
}

function paymentRow(payment: FinancePayment) {
  const appointment = payment.appointment;
  return { paymentId: payment.id, date: appointment.startsAt?.toISOString() || null, patient: appointment.patient ? { id: appointment.patient.id, displayName: `${appointment.patient.firstName} ${appointment.patient.lastName}`.trim() } : { id: null, displayName: `${appointment.invitedPatientFirstName || ''} ${appointment.invitedPatientLastName || ''}`.trim() || 'Paciente invitado' }, doctor: { id: appointment.doctorProfile.id, displayName: `${appointment.doctorProfile.user.firstName} ${appointment.doctorProfile.user.lastName}`.trim() }, clinic: { id: appointment.clinicProfile.id, name: appointment.clinicProfile.name }, service: { id: appointment.service.id, name: appointment.serviceNameSnapshot || appointment.service.name }, amountCents: payment.amountCents, amount: cashAmountFromCents(payment.amountCents), currency: payment.currency, status: payment.status, method: payment.method, confirmedBy: payment.confirmedBy ? { id: payment.confirmedBy.id, displayName: `${payment.confirmedBy.firstName} ${payment.confirmedBy.lastName}`.trim() } : null, confirmedAt: payment.confirmedAt?.toISOString() || null, requiresReview: payment.requiresReview };
}

function grouped(payments: FinancePayment[], keyOf: (payment: FinancePayment) => { key: string; label: string }) {
  const groups = new Map<string, { key: string; label: string; confirmedCashCents: number; pendingCashCents: number; paymentCount: number }>();
  for (const payment of payments) {
    const identity = keyOf(payment); const current = groups.get(identity.key) || { ...identity, confirmedCashCents: 0, pendingCashCents: 0, paymentCount: 0 };
    if (payment.status === 'CONFIRMED') current.confirmedCashCents += payment.amountCents;
    if (payment.status === 'PENDING') current.pendingCashCents += payment.amountCents;
    current.paymentCount += 1; groups.set(identity.key, current);
  }
  return [...groups.values()].sort((a, b) => a.key.localeCompare(b.key));
}

export async function getFinanceSummary(actor: PaymentActor, query: Record<string, string | undefined>) {
  const payments = await prisma.payment.findMany({ where: await financeWhere(actor, query), include: financeInclude });
  const confirmed = payments.filter(payment => payment.status === 'CONFIRMED');
  const pending = payments.filter(payment => payment.status === 'PENDING');
  const cancelled = payments.filter(payment => payment.status === 'CANCELLED');
  const metrics = { confirmedCashCents: confirmed.reduce((sum, payment) => sum + payment.amountCents, 0), pendingCashCents: pending.reduce((sum, payment) => sum + payment.amountCents, 0), cancelledCashCents: cancelled.reduce((sum, payment) => sum + payment.amountCents, 0), requiresReviewCents: payments.filter(payment => payment.requiresReview).reduce((sum, payment) => sum + payment.amountCents, 0), confirmedPaymentCount: confirmed.length, pendingPaymentCount: pending.length, averageConfirmedPaymentCents: confirmed.length ? Math.round(confirmed.reduce((sum, payment) => sum + payment.amountCents, 0) / confirmed.length) : 0 };
  return { label: 'Ingresos registrados', currency: 'USD', metrics, groups: { byDay: grouped(payments, payment => ({ key: payment.appointment.startsAt?.toISOString().slice(0, 10) || 'unknown', label: payment.appointment.startsAt?.toISOString().slice(0, 10) || 'Sin fecha' })), byDoctor: grouped(payments, payment => ({ key: payment.appointment.doctorProfile.id, label: `${payment.appointment.doctorProfile.user.firstName} ${payment.appointment.doctorProfile.user.lastName}`.trim() })), byClinic: grouped(payments, payment => ({ key: payment.appointment.clinicProfile.id, label: payment.appointment.clinicProfile.name })), byService: grouped(payments, payment => ({ key: payment.appointment.service.id, label: payment.appointment.serviceNameSnapshot || payment.appointment.service.name })) } };
}

export async function getFinancePayments(actor: PaymentActor, query: Record<string, string | undefined>) {
  const page = Math.max(1, Number(query.page || 1)); const pageSize = Math.min(100, Math.max(1, Number(query.pageSize || 25)));
  const where = await financeWhere(actor, query);
  const [total, payments] = await Promise.all([prisma.payment.count({ where }), prisma.payment.findMany({ where, include: financeInclude, orderBy: { createdAt: 'desc' }, skip: (page - 1) * pageSize, take: pageSize })]);
  return { page, pageSize, total, items: payments.map(paymentRow) };
}
