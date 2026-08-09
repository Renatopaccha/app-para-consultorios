import crypto from 'crypto';
import { CashPaymentStatus, Prisma } from '../../generated/prisma';
import prisma from '../prisma';
import { emailService } from './email.service';
import { BookingError } from './appointmentBooking.service';
import { assertPaymentFiltersWithinScope, PaymentActor, paymentAppointmentScope } from './cashPaymentAuthorization.service';
import { cashAmountFromCents, cashCodeLast4, cashPaymentCodeExpiresAt, generateCashPaymentCode, hashCashPaymentCode, hashPaymentSecurityValue } from './cashPaymentCode.service';
import { localDateTimeToUtc } from '../utils/scheduling';

const detailsInclude = {
  appointment: {
    include: {
      patient: { select: { id: true, firstName: true, lastName: true, email: true } },
      doctorProfile: { include: { user: { select: { firstName: true, lastName: true } } } },
      clinicProfile: { select: { id: true, name: true } },
      service: { select: { id: true, name: true } },
    },
  },
  confirmedBy: { select: { id: true, firstName: true, lastName: true } },
} satisfies Prisma.PaymentInclude;

type PaymentDetails = Prisma.PaymentGetPayload<{ include: typeof detailsInclude }>;
export type CashPaymentResponse = ReturnType<typeof cashPaymentResponse>;

function cashPaymentResponse(payment: PaymentDetails) {
  const appointment = payment.appointment;
  return {
    paymentId: payment.id,
    method: payment.method,
    status: payment.status,
    patient: appointment.patient ? { id: appointment.patient.id, displayName: `${appointment.patient.firstName} ${appointment.patient.lastName}`.trim() } : { id: null, displayName: `${appointment.invitedPatientFirstName || ''} ${appointment.invitedPatientLastName || ''}`.trim() || 'Paciente invitado' },
    doctor: { id: appointment.doctorProfile.id, displayName: `${appointment.doctorProfile.user.firstName} ${appointment.doctorProfile.user.lastName}`.trim() },
    clinic: { id: appointment.clinicProfile.id, name: appointment.clinicProfile.name },
    appointment: { id: appointment.id, startsAt: appointment.startsAt?.toISOString() || null, serviceName: appointment.serviceNameSnapshot || appointment.service.name },
    amountCents: payment.amountCents,
    amount: cashAmountFromCents(payment.amountCents),
    currency: payment.currency,
    codeExpiresAt: payment.codeExpiresAt.toISOString(),
    confirmedAt: payment.confirmedAt?.toISOString() || null,
    confirmedBy: payment.confirmedBy ? { id: payment.confirmedBy.id, displayName: `${payment.confirmedBy.firstName} ${payment.confirmedBy.lastName}`.trim() } : null,
    confirmedClinicId: payment.confirmedClinicId,
    requiresReview: payment.requiresReview,
  };
}

function maxAttempts(): number { return Math.max(1, Number(process.env.CASH_CODE_MAX_ATTEMPTS || 5)); }
function lockMinutes(): number { return Math.max(1, Number(process.env.CASH_CODE_LOCK_MINUTES || 15)); }
function ipHash(ip: string): string { return hashPaymentSecurityValue(`cash-payment-ip:${ip}`); }

function codeMatches(code: string, expectedHash: string | null): boolean {
  if (!expectedHash) return false;
  const received = Buffer.from(hashCashPaymentCode(code), 'hex');
  const expected = Buffer.from(expectedHash, 'hex');
  return received.length === expected.length && crypto.timingSafeEqual(received, expected);
}

export async function createCashPaymentForAppointment(tx: Prisma.TransactionClient, appointment: { id: string; paymentAmountCents: number | null; paymentCurrency: 'USD' | null; endsAt: Date | null }) {
  if (appointment.paymentAmountCents === null || !appointment.paymentCurrency || !appointment.endsAt) throw new BookingError('PAYMENT_SNAPSHOT_MISSING', 500, 'No se pudo crear el pago histórico.');
  const code = generateCashPaymentCode();
  const payment = await tx.payment.create({ data: { appointmentId: appointment.id, method: 'CASH', status: 'PENDING', amountCents: appointment.paymentAmountCents, currency: appointment.paymentCurrency, verificationCodeHash: hashCashPaymentCode(code), verificationCodeLast4: cashCodeLast4(code), codeExpiresAt: cashPaymentCodeExpiresAt(appointment.endsAt) } });
  await tx.paymentEvent.create({ data: { paymentId: payment.id, eventType: 'CREATED', newStatus: 'PENDING', metadata: { source: 'APPOINTMENT_BOOKING' } } });
  return { payment, code };
}

async function ensureAttemptBudget(actor: PaymentActor, ip: string) {
  const since = new Date(Date.now() - lockMinutes() * 60_000);
  const hashedIp = ipHash(ip);
  const count = await prisma.paymentVerificationAttempt.count({ where: { success: false, createdAt: { gte: since }, OR: [{ actorUserId: actor.id }, { ipHash: hashedIp }] } });
  if (count >= maxAttempts()) throw new BookingError('CASH_PAYMENT_CODE_UNAVAILABLE', 429, 'El código no está disponible para esta operación.');
  return hashedIp;
}

export async function lookupCashPayment(code: string, actor: PaymentActor, ip: string): Promise<CashPaymentResponse> {
  if (!code) throw new BookingError('CASH_PAYMENT_CODE_UNAVAILABLE', 404, 'El código no está disponible para esta operación.');
  const hashedIp = await ensureAttemptBudget(actor, ip);
  const scope = await paymentAppointmentScope(actor);
  const payment = await prisma.payment.findFirst({ where: { verificationCodeHash: hashCashPaymentCode(code), appointment: scope }, include: detailsInclude });
  const now = new Date();
  const available = payment && payment.status === 'PENDING' && payment.codeExpiresAt > now && (!payment.lockedUntil || payment.lockedUntil <= now) && payment.appointment.status !== 'CANCELLED';
  if (!available) {
    await prisma.$transaction(async tx => {
      await tx.paymentVerificationAttempt.create({ data: { paymentId: payment?.id, actorUserId: actor.id, ipHash: hashedIp, success: false } });
      if (payment) await tx.paymentEvent.create({ data: { paymentId: payment.id, eventType: 'LOOKUP_FAILED', actorUserId: actor.id, clinicId: payment.appointment.clinicProfileId, metadata: { reason: 'UNAVAILABLE' } } });
    });
    throw new BookingError('CASH_PAYMENT_CODE_UNAVAILABLE', 404, 'El código no está disponible para esta operación.');
  }
  await prisma.$transaction([
    prisma.paymentVerificationAttempt.create({ data: { paymentId: payment.id, actorUserId: actor.id, ipHash: hashedIp, success: true } }),
    prisma.paymentEvent.create({ data: { paymentId: payment.id, eventType: 'LOOKUP_SUCCEEDED', actorUserId: actor.id, clinicId: payment.appointment.clinicProfileId } }),
  ]);
  return cashPaymentResponse(payment);
}

type ConfirmationError = { code: string; status: number; message: string };

export async function confirmCashPayment(paymentId: string, code: string, idempotencyKey: string, actor: PaymentActor, ip: string): Promise<CashPaymentResponse> {
  if (!paymentId || !code || !idempotencyKey) throw new BookingError('INVALID_CASH_PAYMENT_CONFIRMATION', 400, 'Código e idempotencyKey son obligatorios.');
  const scope = await paymentAppointmentScope(actor);
  const hashedIp = ipHash(ip);
  const outcome = await prisma.$transaction(async tx => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${paymentId}))`;
    const existingKey = await tx.paymentIdempotencyKey.findUnique({ where: { key_scope_userId: { key: idempotencyKey, scope: 'CASH_PAYMENT_CONFIRM', userId: actor.id } } });
    if (existingKey) {
      if (existingKey.paymentId !== paymentId) return { error: { code: 'IDEMPOTENCY_KEY_CONFLICT', status: 409, message: 'La clave ya fue usada para otra operación.' } satisfies ConfirmationError };
      return { response: existingKey.responseBody as unknown as CashPaymentResponse };
    }
    const payment = await tx.payment.findFirst({ where: { id: paymentId, appointment: scope }, include: detailsInclude });
    if (!payment) return { error: { code: 'FORBIDDEN', status: 403, message: 'No tienes permisos.' } satisfies ConfirmationError };
    if (payment.status === 'CONFIRMED') {
      const response = cashPaymentResponse(payment);
      await tx.paymentIdempotencyKey.create({ data: { key: idempotencyKey, scope: 'CASH_PAYMENT_CONFIRM', userId: actor.id, paymentId, responseBody: response } });
      return { response };
    }
    const now = new Date();
    if (payment.status !== 'PENDING' || payment.appointment.status === 'CANCELLED') return { error: { code: 'CASH_PAYMENT_NOT_CONFIRMABLE', status: 422, message: 'El pago no puede confirmarse.' } satisfies ConfirmationError };
    if (payment.appointment.paymentAmountCents !== payment.amountCents || payment.appointment.paymentCurrency !== payment.currency) return { error: { code: 'CASH_PAYMENT_SNAPSHOT_MISMATCH', status: 409, message: 'El importe histórico del pago requiere revisión.' } satisfies ConfirmationError };
    if (payment.codeExpiresAt <= now) return { error: { code: 'CASH_PAYMENT_CODE_EXPIRED', status: 422, message: 'El código no está disponible para esta operación.' } satisfies ConfirmationError };
    if (payment.lockedUntil && payment.lockedUntil > now) return { error: { code: 'CASH_PAYMENT_CODE_LOCKED', status: 429, message: 'El código no está disponible para esta operación.' } satisfies ConfirmationError };
    if (!codeMatches(code, payment.verificationCodeHash)) {
      const attempts = payment.failedVerificationAttempts + 1;
      const lockedUntil = attempts >= maxAttempts() ? new Date(now.getTime() + lockMinutes() * 60_000) : null;
      await tx.payment.update({ where: { id: payment.id }, data: { failedVerificationAttempts: attempts, lockedUntil } });
      await tx.paymentVerificationAttempt.create({ data: { paymentId, actorUserId: actor.id, ipHash: hashedIp, success: false } });
      await tx.paymentEvent.create({ data: { paymentId, eventType: 'LOOKUP_FAILED', actorUserId: actor.id, clinicId: payment.appointment.clinicProfileId, metadata: { reason: lockedUntil ? 'LOCKED' : 'INVALID_CODE', attempt: attempts } } });
      return { error: { code: lockedUntil ? 'CASH_PAYMENT_CODE_LOCKED' : 'CASH_PAYMENT_CODE_UNAVAILABLE', status: lockedUntil ? 429 : 404, message: 'El código no está disponible para esta operación.' } satisfies ConfirmationError };
    }
    const updated = await tx.payment.update({ where: { id: payment.id }, data: { status: 'CONFIRMED', confirmedAt: now, confirmedByUserId: actor.id, confirmedClinicId: payment.appointment.clinicProfileId, verificationCodeHash: null, failedVerificationAttempts: 0, lockedUntil: null } });
    await tx.appointment.update({ where: { id: payment.appointmentId }, data: { paymentStatus: 'PAID', verificationCode: null } });
    await tx.paymentEvent.create({ data: { paymentId, eventType: 'CONFIRMED', previousStatus: 'PENDING', newStatus: 'CONFIRMED', actorUserId: actor.id, clinicId: payment.appointment.clinicProfileId } });
    const reloaded = await tx.payment.findUniqueOrThrow({ where: { id: updated.id }, include: detailsInclude });
    const response = cashPaymentResponse(reloaded);
    await tx.paymentIdempotencyKey.create({ data: { key: idempotencyKey, scope: 'CASH_PAYMENT_CONFIRM', userId: actor.id, paymentId, responseBody: response } });
    await tx.paymentVerificationAttempt.create({ data: { paymentId, actorUserId: actor.id, ipHash: hashedIp, success: true } });
    return { response };
  });
  if ('error' in outcome && outcome.error) throw new BookingError(outcome.error.code, outcome.error.status, outcome.error.message);
  return outcome.response!;
}

export async function reissueCashPaymentCode(paymentId: string, actor: PaymentActor, reason?: string) {
  const appointmentScope = actor.role === 'PATIENT' ? { patientId: actor.id } : await paymentAppointmentScope(actor);
  if (actor.role !== 'PATIENT' && !reason?.trim()) throw new BookingError('REISSUE_REASON_REQUIRED', 400, 'El personal debe registrar una razón.');
  const result = await prisma.$transaction(async tx => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${paymentId}))`;
    const payment = await tx.payment.findFirst({ where: { id: paymentId, appointment: appointmentScope }, include: detailsInclude });
    if (!payment) throw new BookingError('FORBIDDEN', 403, 'No tienes permisos.');
    if (payment.status !== 'PENDING' || payment.appointment.status === 'CANCELLED' || !payment.appointment.endsAt) throw new BookingError('CASH_PAYMENT_REISSUE_NOT_ALLOWED', 422, 'El código no puede reemitirse.');
    const code = generateCashPaymentCode();
    const updated = await tx.payment.update({ where: { id: payment.id }, data: { verificationCodeHash: hashCashPaymentCode(code), verificationCodeLast4: cashCodeLast4(code), codeExpiresAt: cashPaymentCodeExpiresAt(payment.appointment.endsAt), failedVerificationAttempts: 0, lockedUntil: null } });
    await tx.paymentEvent.create({ data: { paymentId, eventType: 'CODE_REISSUED', actorUserId: actor.id, clinicId: actor.role === 'PATIENT' ? null : payment.appointment.clinicProfileId, metadata: { reason: actor.role === 'PATIENT' ? 'PATIENT_REQUEST' : reason!.trim() } } });
    if (!payment.appointment.patient) throw new BookingError('PATIENT_ACCOUNT_REQUIRED', 422, 'El paciente debe crear su cuenta antes de gestionar pagos.');
    return { code, payment: { ...payment, ...updated }, email: { to: payment.appointment.patient.email, doctorName: `${payment.appointment.doctorProfile.user.firstName} ${payment.appointment.doctorProfile.user.lastName}`.trim(), clinicName: payment.appointment.clinicProfile.name, serviceName: payment.appointment.serviceNameSnapshot || payment.appointment.service.name, startsAt: payment.appointment.startsAt!, amountCents: payment.amountCents, currency: payment.currency } };
  });
  await emailService.sendCashPaymentCodeEmail({ ...result.email, code: result.code }).catch(() => undefined);
  return { ...cashPaymentResponse(result.payment), code: result.code };
}

export async function cancelCashPaymentForAppointment(tx: Prisma.TransactionClient, appointmentId: string, actorUserId: string | null, clinicId: string, reason?: string) {
  const payment = await tx.payment.findUnique({ where: { appointmentId } });
  if (!payment) return;
  if (payment.status === 'PENDING') {
    await tx.payment.update({ where: { id: payment.id }, data: { status: 'CANCELLED', verificationCodeHash: null, cancelledAt: new Date(), cancellationReason: reason || null } });
    await tx.paymentEvent.create({ data: { paymentId: payment.id, eventType: 'CANCELLED', previousStatus: 'PENDING', newStatus: 'CANCELLED', actorUserId, clinicId, metadata: reason ? { reason } : undefined } });
  } else if (payment.status === 'CONFIRMED' && !payment.requiresReview) {
    await tx.payment.update({ where: { id: payment.id }, data: { requiresReview: true } });
    await tx.paymentEvent.create({ data: { paymentId: payment.id, eventType: 'CANCELLED_AFTER_CONFIRMATION_REQUIRES_REVIEW', previousStatus: 'CONFIRMED', newStatus: 'CONFIRMED', actorUserId, clinicId } });
  }
}

export async function rescheduleCashPaymentForAppointment(tx: Prisma.TransactionClient, appointmentId: string, newEndsAt: Date, actorUserId: string, clinicId: string) {
  const payment = await tx.payment.findUnique({ where: { appointmentId } });
  if (!payment) return;
  const codeExpiresAt = cashPaymentCodeExpiresAt(newEndsAt);
  await tx.payment.update({ where: { id: payment.id }, data: { codeExpiresAt } });
  await tx.paymentEvent.create({ data: { paymentId: payment.id, eventType: 'STATUS_CHANGED', previousStatus: payment.status, newStatus: payment.status, actorUserId, clinicId, metadata: { action: 'APPOINTMENT_RESCHEDULED', previousCodeExpiresAt: payment.codeExpiresAt.toISOString(), newCodeExpiresAt: codeExpiresAt.toISOString() } } });
}

export async function listCashPayments(actor: PaymentActor, query: Record<string, string | undefined>, pendingOnly = true) {
  await assertPaymentFiltersWithinScope(actor, query);
  const scope = await paymentAppointmentScope(actor);
  const where: Prisma.PaymentWhereInput = { method: 'CASH', ...(pendingOnly ? { status: 'PENDING' } : {}), appointment: { ...scope } };
  if (query.status && ['PENDING', 'CONFIRMED', 'CANCELLED', 'REFUNDED', 'EXEMPTED'].includes(query.status)) where.status = query.status as CashPaymentStatus;
  if (query.patient) where.appointment = { ...scope, patient: { OR: [{ firstName: { contains: query.patient, mode: 'insensitive' } }, { lastName: { contains: query.patient, mode: 'insensitive' } }] } };
  if (query.doctorId && actor.role !== 'DOCTOR') where.appointment = { ...scope, doctorProfileId: query.doctorId };
  if (query.clinicId) where.appointment = { ...scope, clinicProfileId: query.clinicId };
  if (query.date) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(query.date)) throw new BookingError('INVALID_DATE_FILTER', 422, 'La fecha no es válida.');
    const start = localDateTimeToUtc(query.date, '00:00');
    const end = new Date(start.getTime() + 86_400_000);
    where.appointment = { ...scope, ...(where.appointment as Prisma.AppointmentWhereInput), startsAt: { gte: start, lt: end } };
  }
  const payments = await prisma.payment.findMany({ where, include: detailsInclude, orderBy: { appointment: { startsAt: 'asc' } } });
  return payments.map(cashPaymentResponse);
}

export { cashPaymentResponse };
