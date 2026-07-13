import request from 'supertest';
import app from '../../app';
import prisma, { disconnectPrisma } from '../../prisma';
import { generateToken } from '../../utils/jwt';
import { clearIntegrationDatabase, assertIntegrationDatabase } from './testDatabase';
import { CashPaymentCodeEmail, setCashPaymentCodeEmailAdapterForTests } from '../../services/email.service';
import { cashPaymentCodeExpiresAt, hashCashPaymentCode } from '../../services/cashPaymentCode.service';

describe('pagos en efectivo auditables con PostgreSQL real', () => {
  let doctorId = ''; let clinicId = ''; let patientId = ''; let serviceId = '';
  let otherDoctorId = ''; let otherClinicId = ''; let otherServiceId = '';
  let patientToken = ''; let doctorToken = ''; let clinicToken = ''; let assistantToken = '';
  let otherDoctorToken = ''; let otherClinicToken = ''; let otherAssistantToken = '';
  let superAdminToken = '';
  let sentEmails: CashPaymentCodeEmail[] = [];

  beforeEach(async () => {
    assertIntegrationDatabase(); await clearIntegrationDatabase(); sentEmails = [];
    setCashPaymentCodeEmailAdapterForTests(async email => { sentEmails.push(email); });
    const users = await Promise.all([
      prisma.user.create({ data: { email: 'cash-doctor@zenda.test', firstName: 'Ana', lastName: 'Médica', passwordHash: 'x', role: 'DOCTOR' } }),
      prisma.user.create({ data: { email: 'cash-clinic@zenda.test', firstName: 'Clínica', lastName: 'Principal', passwordHash: 'x', role: 'CLINIC_ADMIN' } }),
      prisma.user.create({ data: { email: 'cash-patient@zenda.test', firstName: 'Juan', lastName: 'Paciente', passwordHash: 'x', role: 'PATIENT' } }),
      prisma.user.create({ data: { email: 'cash-assistant@zenda.test', firstName: 'Sara', lastName: 'Asistente', passwordHash: 'x', role: 'ASSISTANT' } }),
      prisma.user.create({ data: { email: 'cash-other-doctor@zenda.test', firstName: 'Otro', lastName: 'Médico', passwordHash: 'x', role: 'DOCTOR' } }),
      prisma.user.create({ data: { email: 'cash-other-clinic@zenda.test', firstName: 'Otra', lastName: 'Clínica', passwordHash: 'x', role: 'CLINIC_ADMIN' } }),
      prisma.user.create({ data: { email: 'cash-other-assistant@zenda.test', firstName: 'Otra', lastName: 'Asistente', passwordHash: 'x', role: 'ASSISTANT' } }),
    ]);
    const [doctorUser, clinicUser, patient, assistantUser, otherDoctorUser, otherClinicUser, otherAssistantUser] = users;
    const superAdmin = await prisma.user.create({ data: { email: 'cash-superadmin@zenda.test', firstName: 'Super', lastName: 'Admin', passwordHash: 'x', role: 'SUPER_ADMIN' } });
    const doctor = await prisma.doctorProfile.create({ data: { userId: doctorUser.id, licenseNumber: 'CASH-001', consultationPrice: 0, verificationStatus: 'APPROVED', isVerified: true } });
    const clinic = await prisma.clinicProfile.create({ data: { userId: clinicUser.id, name: 'Clínica Principal', address: 'Quito', verificationStatus: 'APPROVED' } });
    const otherDoctor = await prisma.doctorProfile.create({ data: { userId: otherDoctorUser.id, licenseNumber: 'CASH-002', consultationPrice: 0, verificationStatus: 'APPROVED', isVerified: true } });
    const otherClinic = await prisma.clinicProfile.create({ data: { userId: otherClinicUser.id, name: 'Clínica Ajena', address: 'Guayaquil', verificationStatus: 'APPROVED' } });
    await prisma.assistantProfile.create({ data: { userId: assistantUser.id, doctorProfileId: doctor.id, canViewFinances: true } });
    await prisma.assistantProfile.create({ data: { userId: otherAssistantUser.id, doctorProfileId: otherDoctor.id, canViewFinances: true } });
    const workplace = await prisma.doctorClinicWorkplace.create({ data: { doctorProfileId: doctor.id, clinicProfileId: clinic.id } });
    const otherWorkplace = await prisma.doctorClinicWorkplace.create({ data: { doctorProfileId: otherDoctor.id, clinicProfileId: otherClinic.id } });
    await prisma.workSchedule.createMany({ data: [workplace, otherWorkplace].flatMap(item => Array.from({ length: 7 }, (_, weekday) => ({ workplaceId: item.id, weekday, startTime: '08:00', endTime: '18:00' }))) });
    const service = await prisma.service.create({ data: { name: 'Consulta histórica', price: 35.5, priceCents: 3550, currency: 'USD', duration: 45, doctorProfileId: doctor.id } });
    const otherService = await prisma.service.create({ data: { name: 'Consulta ajena', price: 40, priceCents: 4000, currency: 'USD', duration: 30, doctorProfileId: otherDoctor.id } });
    doctorId = doctor.id; clinicId = clinic.id; patientId = patient.id; serviceId = service.id; otherDoctorId = otherDoctor.id; otherClinicId = otherClinic.id; otherServiceId = otherService.id;
    patientToken = generateToken({ id: patient.id, role: 'PATIENT' }); doctorToken = generateToken({ id: doctorUser.id, role: 'DOCTOR' }); clinicToken = generateToken({ id: clinicUser.id, role: 'CLINIC_ADMIN' }); assistantToken = generateToken({ id: assistantUser.id, role: 'ASSISTANT' });
    otherDoctorToken = generateToken({ id: otherDoctorUser.id, role: 'DOCTOR' }); otherClinicToken = generateToken({ id: otherClinicUser.id, role: 'CLINIC_ADMIN' }); otherAssistantToken = generateToken({ id: otherAssistantUser.id, role: 'ASSISTANT' });
    superAdminToken = generateToken({ id: superAdmin.id, role: 'SUPER_ADMIN' });
  });

  afterAll(async () => { setCashPaymentCodeEmailAdapterForTests(undefined); await clearIntegrationDatabase(); await disconnectPrisma(); });

  async function bookCash(startsAt = '2026-09-01T09:00:00-05:00', target = { doctorId, clinicId, serviceId }) {
    return request(app).post('/api/bookings/book').set('Authorization', `Bearer ${patientToken}`).send({ ...target, startsAt, paymentMethod: 'CASH' }).expect(201);
  }

  it('crea cita, pago, hash, snapshot, evento y correo simulado en una transacción', async () => {
    const booked = await bookCash();
    expect(booked.body.cashPaymentCode).toMatch(/^[2-9A-HJ-KM-NP-Z]{4}-[2-9A-HJ-KM-NP-Z]{4}$/);
    expect(booked.body.verificationCode).toBeNull();
    const payment = await prisma.payment.findUniqueOrThrow({ where: { appointmentId: booked.body.id } });
    expect(payment).toMatchObject({ method: 'CASH', status: 'PENDING', amountCents: 3550, currency: 'USD' });
    expect(payment.verificationCodeHash).toBe(hashCashPaymentCode(booked.body.cashPaymentCode));
    expect(JSON.stringify(payment)).not.toContain(booked.body.cashPaymentCode);
    expect(await prisma.paymentEvent.count({ where: { paymentId: payment.id, eventType: 'CREATED' } })).toBe(1);
    expect(sentEmails).toHaveLength(1);
    expect(sentEmails[0]).toMatchObject({ code: booked.body.cashPaymentCode, amountCents: 3550, serviceName: 'Consulta histórica' });
    await prisma.service.update({ where: { id: serviceId }, data: { price: 99, priceCents: 9900 } });
    expect((await prisma.payment.findUniqueOrThrow({ where: { id: payment.id } })).amountCents).toBe(3550);
  });

  it('limita lookup al médico, clínica y asistente realmente asignados', async () => {
    const booked = await bookCash(); const code = booked.body.cashPaymentCode;
    await request(app).post('/api/cash-payments/lookup').set('Authorization', `Bearer ${doctorToken}`).send({ code }).expect(200);
    await request(app).post('/api/cash-payments/lookup').set('Authorization', `Bearer ${clinicToken}`).send({ code }).expect(200);
    await request(app).post('/api/cash-payments/lookup').set('Authorization', `Bearer ${assistantToken}`).send({ code }).expect(200);
    await request(app).post('/api/cash-payments/lookup').set('Authorization', `Bearer ${superAdminToken}`).send({ code }).expect(200);
    await request(app).post('/api/cash-payments/lookup').set('Authorization', `Bearer ${otherDoctorToken}`).send({ code }).expect(404);
    await request(app).post('/api/cash-payments/lookup').set('Authorization', `Bearer ${otherClinicToken}`).send({ code }).expect(404);
    await request(app).post('/api/cash-payments/lookup').set('Authorization', `Bearer ${otherAssistantToken}`).send({ code }).expect(404);
    await request(app).post('/api/cash-payments/lookup').set('Authorization', `Bearer ${patientToken}`).send({ code }).expect(403);
  });

  it('cuenta intentos incorrectos, bloquea temporalmente y nunca guarda el código', async () => {
    const booked = await bookCash(); const payment = await prisma.payment.findUniqueOrThrow({ where: { appointmentId: booked.body.id } });
    for (let index = 1; index <= 4; index += 1) await request(app).post(`/api/cash-payments/${payment.id}/confirm`).set('Authorization', `Bearer ${doctorToken}`).send({ code: 'ZZZZ-ZZZZ', idempotencyKey: `wrong-${index}` }).expect(404);
    await request(app).post(`/api/cash-payments/${payment.id}/confirm`).set('Authorization', `Bearer ${doctorToken}`).send({ code: 'ZZZZ-ZZZZ', idempotencyKey: 'wrong-5' }).expect(429);
    const locked = await prisma.payment.findUniqueOrThrow({ where: { id: payment.id } });
    expect(locked.failedVerificationAttempts).toBe(5); expect(locked.lockedUntil).not.toBeNull();
    expect(await prisma.paymentVerificationAttempt.count({ where: { paymentId: payment.id, success: false } })).toBe(5);
    expect(JSON.stringify(await prisma.paymentEvent.findMany({ where: { paymentId: payment.id } }))).not.toContain('ZZZZ-ZZZZ');
    await request(app).post(`/api/cash-payments/${payment.id}/confirm`).set('Authorization', `Bearer ${doctorToken}`).send({ code: booked.body.cashPaymentCode, idempotencyKey: 'correct-but-locked' }).expect(429);
  });

  it('confirma con actor y clínica sin tocar estado, confirmación ni reseñas y es idempotente', async () => {
    const booked = await bookCash(); const payment = await prisma.payment.findUniqueOrThrow({ where: { appointmentId: booked.body.id } });
    const before = await prisma.appointment.findUniqueOrThrow({ where: { id: booked.body.id } });
    const first = await request(app).post(`/api/cash-payments/${payment.id}/confirm`).set('Authorization', `Bearer ${doctorToken}`).send({ code: booked.body.cashPaymentCode, idempotencyKey: 'cash-confirm-1' }).expect(200);
    expect(first.body).toMatchObject({ status: 'CONFIRMED', amountCents: 3550, confirmedClinicId: clinicId });
    await request(app).post(`/api/cash-payments/${payment.id}/confirm`).set('Authorization', `Bearer ${doctorToken}`).send({ code: booked.body.cashPaymentCode, idempotencyKey: 'cash-confirm-1' }).expect(200);
    await request(app).post(`/api/cash-payments/${payment.id}/confirm`).set('Authorization', `Bearer ${doctorToken}`).send({ code: 'NO-LONGER-USED', idempotencyKey: 'cash-confirm-2' }).expect(200);
    const after = await prisma.appointment.findUniqueOrThrow({ where: { id: booked.body.id } });
    expect(after.status).toBe(before.status); expect(after.patientConfirmationStatus).toBe(before.patientConfirmationStatus); expect(after.paymentStatus).toBe('PAID');
    expect(await prisma.review.count({ where: { appointmentId: booked.body.id } })).toBe(0);
    expect(await prisma.paymentEvent.count({ where: { paymentId: payment.id, eventType: 'CONFIRMED' } })).toBe(1);
    const stored = await prisma.payment.findUniqueOrThrow({ where: { id: payment.id } });
    expect(stored.confirmedByUserId).not.toBeNull(); expect(stored.confirmedClinicId).toBe(clinicId); expect(stored.verificationCodeHash).toBeNull();
  });

  it('serializa dos confirmaciones simultáneas y crea un solo ingreso/evento', async () => {
    const booked = await bookCash(); const payment = await prisma.payment.findUniqueOrThrow({ where: { appointmentId: booked.body.id } });
    const responses = await Promise.all(['parallel-a', 'parallel-b'].map(idempotencyKey => request(app).post(`/api/cash-payments/${payment.id}/confirm`).set('Authorization', `Bearer ${doctorToken}`).send({ code: booked.body.cashPaymentCode, idempotencyKey })));
    expect(responses.map(response => response.status)).toEqual([200, 200]);
    expect(await prisma.paymentEvent.count({ where: { paymentId: payment.id, eventType: 'CONFIRMED' } })).toBe(1);
    expect(await prisma.paymentIdempotencyKey.count({ where: { paymentId: payment.id } })).toBe(2);
    const summary = await request(app).get('/api/finance/summary').set('Authorization', `Bearer ${doctorToken}`).expect(200);
    expect(summary.body.metrics).toMatchObject({ confirmedCashCents: 3550, confirmedPaymentCount: 1 });
  });

  it('cancela pago pendiente y marca revisión si la cita ya estaba pagada', async () => {
    const pendingBooking = await bookCash('2026-09-02T09:00:00-05:00');
    await request(app).patch(`/api/bookings/${pendingBooking.body.id}/cancel`).set('Authorization', `Bearer ${patientToken}`).send({ reason: 'Paciente cancela' }).expect(200);
    const pendingPayment = await prisma.payment.findUniqueOrThrow({ where: { appointmentId: pendingBooking.body.id } });
    expect(pendingPayment).toMatchObject({ status: 'CANCELLED', verificationCodeHash: null, requiresReview: false });
    expect(await prisma.paymentEvent.count({ where: { paymentId: pendingPayment.id, eventType: 'CANCELLED' } })).toBe(1);

    const paidBooking = await bookCash('2026-09-03T09:00:00-05:00'); const paidPayment = await prisma.payment.findUniqueOrThrow({ where: { appointmentId: paidBooking.body.id } });
    await request(app).post(`/api/cash-payments/${paidPayment.id}/confirm`).set('Authorization', `Bearer ${doctorToken}`).send({ code: paidBooking.body.cashPaymentCode, idempotencyKey: 'before-cancel' }).expect(200);
    await request(app).patch(`/api/bookings/${paidBooking.body.id}/cancel`).set('Authorization', `Bearer ${patientToken}`).send({ reason: 'Revisar efectivo' }).expect(200);
    expect(await prisma.payment.findUniqueOrThrow({ where: { id: paidPayment.id } })).toMatchObject({ status: 'CONFIRMED', requiresReview: true });
    expect(await prisma.paymentEvent.count({ where: { paymentId: paidPayment.id, eventType: 'CANCELLED_AFTER_CONFIRMATION_REQUIRES_REVIEW' } })).toBe(1);
  });

  it('reprograma sin cambiar pago/código/importe y recalcula la expiración', async () => {
    const booked = await bookCash('2026-09-04T09:00:00-05:00'); const before = await prisma.payment.findUniqueOrThrow({ where: { appointmentId: booked.body.id } });
    await request(app).patch(`/api/bookings/${booked.body.id}/reschedule`).set('Authorization', `Bearer ${patientToken}`).send({ startsAt: '2026-09-05T10:00:00-05:00' }).expect(200);
    const after = await prisma.payment.findUniqueOrThrow({ where: { id: before.id } });
    expect(after.amountCents).toBe(before.amountCents); expect(after.verificationCodeHash).toBe(before.verificationCodeHash);
    expect(after.codeExpiresAt).toEqual(cashPaymentCodeExpiresAt(new Date('2026-09-05T15:45:00.000Z')));
    await request(app).post('/api/cash-payments/lookup').set('Authorization', `Bearer ${doctorToken}`).send({ code: booked.body.cashPaymentCode }).expect(200);
  });

  it('reemitir conserva el pago, invalida el código anterior y entrega uno nuevo', async () => {
    const booked = await bookCash('2026-09-06T09:00:00-05:00'); const payment = await prisma.payment.findUniqueOrThrow({ where: { appointmentId: booked.body.id } });
    const reissued = await request(app).post(`/api/cash-payments/${payment.id}/reissue-code`).set('Authorization', `Bearer ${patientToken}`).send({}).expect(200);
    expect(reissued.body.code).not.toBe(booked.body.cashPaymentCode); expect(reissued.body.amountCents).toBe(3550);
    await request(app).post('/api/cash-payments/lookup').set('Authorization', `Bearer ${doctorToken}`).send({ code: booked.body.cashPaymentCode }).expect(404);
    await request(app).post('/api/cash-payments/lookup').set('Authorization', `Bearer ${doctorToken}`).send({ code: reissued.body.code }).expect(200);
    expect(await prisma.payment.count({ where: { appointmentId: booked.body.id } })).toBe(1);
    expect(await prisma.paymentEvent.count({ where: { paymentId: payment.id, eventType: 'CODE_REISSUED' } })).toBe(1);
    expect(sentEmails.at(-1)?.code).toBe(reissued.body.code);
  });

  it('rechaza código vencido o pago cancelado de forma genérica', async () => {
    const expiredBooking = await bookCash('2026-09-07T09:00:00-05:00'); const expiredPayment = await prisma.payment.findUniqueOrThrow({ where: { appointmentId: expiredBooking.body.id } });
    await prisma.payment.update({ where: { id: expiredPayment.id }, data: { codeExpiresAt: new Date('2020-01-01T00:00:00.000Z') } });
    await request(app).post('/api/cash-payments/lookup').set('Authorization', `Bearer ${doctorToken}`).send({ code: expiredBooking.body.cashPaymentCode }).expect(404);
    await request(app).post(`/api/cash-payments/${expiredPayment.id}/confirm`).set('Authorization', `Bearer ${doctorToken}`).send({ code: expiredBooking.body.cashPaymentCode, idempotencyKey: 'expired' }).expect(422);
    const cancelledBooking = await bookCash('2026-09-08T09:00:00-05:00');
    await request(app).patch(`/api/bookings/${cancelledBooking.body.id}/cancel`).set('Authorization', `Bearer ${patientToken}`).send({}).expect(200);
    await request(app).post('/api/cash-payments/lookup').set('Authorization', `Bearer ${doctorToken}`).send({ code: cancelledBooking.body.cashPaymentCode }).expect(404);
  });

  it('deriva pendientes y finanzas de Payment respetando alcance y bloqueando pacientes', async () => {
    const mainPaid = await bookCash('2026-09-09T09:00:00-05:00'); const mainPayment = await prisma.payment.findUniqueOrThrow({ where: { appointmentId: mainPaid.body.id } });
    await request(app).post(`/api/cash-payments/${mainPayment.id}/confirm`).set('Authorization', `Bearer ${doctorToken}`).send({ code: mainPaid.body.cashPaymentCode, idempotencyKey: 'main-finance' }).expect(200);
    await bookCash('2026-09-09T11:00:00-05:00');
    const other = await bookCash('2026-09-10T09:00:00-05:00', { doctorId: otherDoctorId, clinicId: otherClinicId, serviceId: otherServiceId });
    const otherPayment = await prisma.payment.findUniqueOrThrow({ where: { appointmentId: other.body.id } });
    await request(app).post(`/api/cash-payments/${otherPayment.id}/confirm`).set('Authorization', `Bearer ${otherDoctorToken}`).send({ code: other.body.cashPaymentCode, idempotencyKey: 'other-finance' }).expect(200);

    const doctorSummary = await request(app).get('/api/finance/summary').set('Authorization', `Bearer ${doctorToken}`).expect(200);
    expect(doctorSummary.body.metrics).toMatchObject({ confirmedCashCents: 3550, pendingCashCents: 3550, confirmedPaymentCount: 1, pendingPaymentCount: 1, averageConfirmedPaymentCents: 3550 });
    expect(doctorSummary.body.groups.byDoctor).toHaveLength(1);
    const clinicPayments = await request(app).get('/api/finance/payments').set('Authorization', `Bearer ${clinicToken}`).expect(200);
    expect(clinicPayments.body.total).toBe(2);
    const assistantPayments = await request(app).get('/api/finance/payments').set('Authorization', `Bearer ${assistantToken}`).expect(200);
    expect(assistantPayments.body.total).toBe(2);
    const otherDoctorPayments = await request(app).get('/api/finance/payments').set('Authorization', `Bearer ${otherDoctorToken}`).expect(200);
    expect(otherDoctorPayments.body.total).toBe(1);
    const pending = await request(app).get('/api/cash-payments/pending').set('Authorization', `Bearer ${doctorToken}`).expect(200);
    expect(pending.body).toHaveLength(1);
    await request(app).get('/api/finance/summary').set('Authorization', `Bearer ${patientToken}`).expect(403);
  });

  it('mantiene la ruta heredada como adaptador deprecado al nuevo pago', async () => {
    const booked = await bookCash('2026-09-11T09:00:00-05:00');
    const response = await request(app).post('/api/bookings/verify-payment').set('Authorization', `Bearer ${doctorToken}`).send({ verificationCode: booked.body.cashPaymentCode }).expect(200);
    expect(response.headers.deprecation).toBe('true'); expect(response.body.payment.status).toBe('CONFIRMED'); expect(response.body.appointment.status).toBe('PENDING');
    const payment = await prisma.payment.findUniqueOrThrow({ where: { appointmentId: booked.body.id } });
    expect(await prisma.paymentEvent.count({ where: { paymentId: payment.id, eventType: 'CONFIRMED' } })).toBe(1);
  });

  it('expone códigos de calendario derivados del Payment canónico', async () => {
    const booked = await bookCash('2026-09-12T09:00:00-05:00');
    await request(app).patch(`/api/bookings/${booked.body.id}/confirm`).set('Authorization', `Bearer ${patientToken}`).send({}).expect(200);
    const pendingCalendar = await request(app).get('/api/bookings').set('Authorization', `Bearer ${doctorToken}`).expect(200);
    expect(pendingCalendar.body.find((item: any) => item.id === booked.body.id).displayCode).toBe('CONFIRMED_PAYMENT_PENDING');
    const payment = await prisma.payment.findUniqueOrThrow({ where: { appointmentId: booked.body.id } });
    await request(app).post(`/api/cash-payments/${payment.id}/confirm`).set('Authorization', `Bearer ${doctorToken}`).send({ code: booked.body.cashPaymentCode, idempotencyKey: 'calendar-paid' }).expect(200);
    const paidCalendar = await request(app).get('/api/bookings').set('Authorization', `Bearer ${doctorToken}`).expect(200);
    expect(paidCalendar.body.find((item: any) => item.id === booked.body.id).displayCode).toBe('CONFIRMED_AND_PAID');
  });
});
