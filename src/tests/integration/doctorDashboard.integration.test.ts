import request from 'supertest';
import app from '../../app';
import prisma, { disconnectPrisma } from '../../prisma';
import { generateToken } from '../../utils/jwt';
import { localDate, localDateTimeToUtc } from '../../utils/scheduling';
import { assertIntegrationDatabase, clearIntegrationDatabase } from './testDatabase';

describe('dashboard real del doctor con PostgreSQL', () => {
  beforeEach(async () => { assertIntegrationDatabase(); await clearIntegrationDatabase(); });
  afterAll(async () => { await clearIntegrationDatabase(); await disconnectPrisma(); });

  it('agrega solo datos propios, respeta sede y calcula dinero/bloqueos/notificaciones', async () => {
    const users = await Promise.all([
      prisma.user.create({ data: { email: 'dashboard-doctor@zenda.test', emailNormalized: 'dashboard-doctor@zenda.test', firstName: 'Ana', lastName: 'Dashboard', passwordHash: 'x', role: 'DOCTOR' } }),
      prisma.user.create({ data: { email: 'dashboard-other@zenda.test', emailNormalized: 'dashboard-other@zenda.test', firstName: 'Otro', lastName: 'Doctor', passwordHash: 'x', role: 'DOCTOR' } }),
      prisma.user.create({ data: { email: 'dashboard-clinic@zenda.test', emailNormalized: 'dashboard-clinic@zenda.test', firstName: 'Clínica', lastName: 'Uno', passwordHash: 'x', role: 'CLINIC_ADMIN' } }),
      prisma.user.create({ data: { email: 'dashboard-foreign@zenda.test', emailNormalized: 'dashboard-foreign@zenda.test', firstName: 'Clínica', lastName: 'Ajena', passwordHash: 'x', role: 'CLINIC_ADMIN' } }),
      prisma.user.create({ data: { email: 'dashboard-patient@zenda.test', emailNormalized: 'dashboard-patient@zenda.test', firstName: 'Paciente', lastName: 'Real', passwordHash: 'x', role: 'PATIENT' } }),
    ]);
    const [doctorUser, otherUser, clinicUser, foreignClinicUser, patient] = users;
    const doctor = await prisma.doctorProfile.create({ data: { userId: doctorUser.id, licenseNumber: 'DASH-1', consultationPrice: 50 } });
    const other = await prisma.doctorProfile.create({ data: { userId: otherUser.id, licenseNumber: 'DASH-2', consultationPrice: 50 } });
    const clinic = await prisma.clinicProfile.create({ data: { userId: clinicUser.id, name: 'Consultorio Centro', address: 'Quito' } });
    const foreignClinic = await prisma.clinicProfile.create({ data: { userId: foreignClinicUser.id, name: 'Clínica Ajena', address: 'Quito' } });
    await prisma.doctorClinicWorkplace.createMany({ data: [{ doctorProfileId: doctor.id, clinicProfileId: clinic.id }, { doctorProfileId: other.id, clinicProfileId: foreignClinic.id }] });
    const service = await prisma.service.create({ data: { name: 'Consulta', doctorProfileId: doctor.id, price: 35, priceCents: 3500, duration: 30 } });
    const otherService = await prisma.service.create({ data: { name: 'Ajena', doctorProfileId: other.id, price: 999, priceCents: 99900, duration: 30 } });
    const day = localDate(new Date()); const dayStart = localDateTimeToUtc(day, '00:00');
    const appointment = async (input: { doctorId: string; clinicId: string; serviceId: string; time: string; status: 'PENDING' | 'CONFIRMED' | 'COMPLETED' | 'MISSED'; amount: number }) => {
      const startsAt = localDateTimeToUtc(day, input.time); const endsAt = new Date(startsAt.getTime() + 30 * 60_000);
      return prisma.appointment.create({ data: { patientId: patient.id, doctorProfileId: input.doctorId, clinicProfileId: input.clinicId, serviceId: input.serviceId, date: dayStart, startTime: input.time, endTime: new Intl.DateTimeFormat('en-GB', { timeZone: 'America/Guayaquil', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(endsAt), startDatetime: startsAt, startsAt, endsAt, status: input.status, paymentMethod: 'CASH', paymentStatus: 'PENDING_CASH', serviceNameSnapshot: 'Consulta', servicePriceCentsSnapshot: input.amount, serviceDurationMinutesSnapshot: 30, currencySnapshot: 'USD', paymentAmountCents: input.amount, paymentCurrency: 'USD' } });
    };
    const confirmedAppointment = await appointment({ doctorId: doctor.id, clinicId: clinic.id, serviceId: service.id, time: '08:00', status: 'COMPLETED', amount: 3500 });
    const pendingAppointment = await appointment({ doctorId: doctor.id, clinicId: clinic.id, serviceId: service.id, time: '09:00', status: 'PENDING', amount: 2000 });
    const missedAppointment = await appointment({ doctorId: doctor.id, clinicId: clinic.id, serviceId: service.id, time: '10:00', status: 'MISSED', amount: 1000 });
    const foreignAppointment = await appointment({ doctorId: other.id, clinicId: foreignClinic.id, serviceId: otherService.id, time: '08:00', status: 'COMPLETED', amount: 99900 });
    await prisma.payment.createMany({ data: [
      { appointmentId: confirmedAppointment.id, method: 'CASH', status: 'CONFIRMED', amountCents: 3500, currency: 'USD', codeExpiresAt: new Date(Date.now() + 86_400_000) },
      { appointmentId: pendingAppointment.id, method: 'CASH', status: 'PENDING', amountCents: 2000, currency: 'USD', codeExpiresAt: new Date(Date.now() + 86_400_000) },
      { appointmentId: missedAppointment.id, method: 'CASH', status: 'CANCELLED', amountCents: 1000, currency: 'USD', codeExpiresAt: new Date(Date.now() + 86_400_000) },
      { appointmentId: foreignAppointment.id, method: 'CASH', status: 'CONFIRMED', amountCents: 99900, currency: 'USD', codeExpiresAt: new Date(Date.now() + 86_400_000) },
    ] });
    await prisma.scheduleBlock.create({ data: { doctorProfileId: doctor.id, clinicProfileId: clinic.id, startsAt: localDateTimeToUtc(day, '12:00'), endsAt: localDateTimeToUtc(day, '12:45'), type: 'BLOCK', createdByUserId: doctorUser.id } });
    await prisma.userNotification.createMany({ data: [
      { userId: doctorUser.id, outboxId: 'dashboard-own', type: 'APPOINTMENT_CREATED', title: 'Nueva cita', message: 'Mensaje seguro', data: { appointmentId: pendingAppointment.id } },
      { userId: otherUser.id, outboxId: 'dashboard-other', type: 'APPOINTMENT_CREATED', title: 'Ajena', message: 'No visible' },
    ] });
    const tomorrow = new Date(dayStart.getTime() + 86_400_000); const nextStart = new Date(tomorrow.getTime() + 14 * 60 * 60_000);
    await prisma.appointment.create({ data: { patientId: patient.id, doctorProfileId: doctor.id, clinicProfileId: clinic.id, serviceId: service.id, date: tomorrow, startTime: '09:00', endTime: '09:30', startDatetime: nextStart, startsAt: nextStart, endsAt: new Date(nextStart.getTime() + 30 * 60_000), status: 'CONFIRMED', paymentMethod: 'NONE', paymentStatus: 'PAID', serviceNameSnapshot: 'Consulta futura', servicePriceCentsSnapshot: 3500, serviceDurationMinutesSnapshot: 30, currencySnapshot: 'USD', paymentAmountCents: 3500, paymentCurrency: 'USD' } });

    const token = generateToken({ id: doctorUser.id, role: 'DOCTOR' });
    const response = await request(app).get('/api/doctors/me/dashboard-summary').query({ clinicId: clinic.id }).set('Authorization', `Bearer ${token}`).expect(200);
    expect(response.body.today).toEqual({ total: 3, pending: 1, confirmed: 0, completed: 1, missed: 1 });
    expect(response.body.finance).toEqual({ confirmedRevenueCents: 3500, pendingRevenueCents: 2000, pendingCashPayments: 1 });
    expect(response.body.schedule.blockedMinutes).toBe(45);
    expect(response.body.notifications.unreadCount).toBe(1);
    expect(response.body.nextAppointment).toMatchObject({ patientDisplayName: 'Paciente Real', serviceName: 'Consulta futura', clinicName: 'Consultorio Centro' });
    expect(JSON.stringify(response.body)).not.toContain('99900');
    await request(app).get('/api/doctors/me/dashboard-summary').query({ clinicId: foreignClinic.id }).set('Authorization', `Bearer ${token}`).expect(403);
  });
});
