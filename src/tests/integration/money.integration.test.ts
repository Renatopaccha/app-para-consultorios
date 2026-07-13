import bcrypt from 'bcrypt';
import request from 'supertest';
import app from '../../app';
import prisma, { disconnectPrisma } from '../../prisma';
import { clearIntegrationDatabase, assertIntegrationDatabase } from './testDatabase';
import { generateToken } from '../../utils/jwt';

describe('snapshot monetario con PostgreSQL real', () => {
  let doctorId = ''; let clinicId = ''; let patientId = ''; let doctorToken = ''; let patientToken = '';
  beforeEach(async () => {
    assertIntegrationDatabase(); await clearIntegrationDatabase();
    const [doctorUser, clinicUser, patient] = await Promise.all([
      prisma.user.create({ data: { email: 'doctor.money@zenda.test', firstName: 'Doc', lastName: 'Money', passwordHash: await bcrypt.hash('password-123456', 4), role: 'DOCTOR' } }),
      prisma.user.create({ data: { email: 'clinic.money@zenda.test', firstName: 'Clinic', lastName: 'Money', passwordHash: 'x', role: 'CLINIC_ADMIN' } }),
      prisma.user.create({ data: { email: 'patient.money@zenda.test', firstName: 'Patient', lastName: 'Money', passwordHash: 'x', role: 'PATIENT' } }),
    ]);
    const doctor = await prisma.doctorProfile.create({ data: { userId: doctorUser.id, licenseNumber: 'MONEY-001', consultationPrice: 0, verificationStatus: 'APPROVED', isVerified: true } });
    const clinic = await prisma.clinicProfile.create({ data: { userId: clinicUser.id, name: 'Clinic Money', address: 'Test', verificationStatus: 'APPROVED' } });
    const workplace = await prisma.doctorClinicWorkplace.create({ data: { doctorProfileId: doctor.id, clinicProfileId: clinic.id } });
    await prisma.workSchedule.createMany({ data: Array.from({ length: 7 }, (_, weekday) => ({ workplaceId: workplace.id, weekday, startTime: '08:00', endTime: '18:00' })) });
    doctorId = doctor.id; clinicId = clinic.id; patientId = patient.id;
    doctorToken = generateToken({ id: doctorUser.id, role: 'DOCTOR' }); patientToken = generateToken({ id: patient.id, role: 'PATIENT' });
  });
  afterAll(async () => { await clearIntegrationDatabase(); await disconnectPrisma(); });

  it('persiste $35.50 en 3550, crea snapshot y no acepta precio o duración del cliente', async () => {
    const service = await request(app).post('/api/doctors/services').set('Authorization', `Bearer ${doctorToken}`)
      .send({ name: 'Consulta Money', price: 35.5, duration: 45 }).expect(201);
    expect(service.body).toMatchObject({ priceCents: 3550, price: 35.5, currency: 'USD' });
    const booking = await request(app).post('/api/bookings/book').set('Authorization', `Bearer ${patientToken}`)
      .send({ doctorId, clinicId, serviceId: service.body.id, date: '2026-08-01', startTime: '09:00', paymentMethod: 'CASH', price: 1, duration: 1 }).expect(201);
    expect(booking.body).toMatchObject({ serviceNameSnapshot: 'Consulta Money', servicePriceCentsSnapshot: 3550, serviceDurationMinutesSnapshot: 45, currencySnapshot: 'USD', paymentAmountCents: 3550, paymentCurrency: 'USD' });
    expect(booking.body.endTime).toBe('09:45');
    await prisma.service.update({ where: { id: service.body.id }, data: { price: 99, priceCents: 9900, duration: 90 } });
    const historic = await prisma.appointment.findUniqueOrThrow({ where: { id: booking.body.id } });
    expect(historic.servicePriceCentsSnapshot).toBe(3550);
    expect(historic.serviceDurationMinutesSnapshot).toBe(45);
  });

  it('rechaza reservar un servicio de otro médico', async () => {
    const otherUser = await prisma.user.create({ data: { email: 'other.money@zenda.test', firstName: 'Other', lastName: 'Doc', passwordHash: 'x', role: 'DOCTOR' } });
    const otherDoctor = await prisma.doctorProfile.create({ data: { userId: otherUser.id, licenseNumber: 'MONEY-002', consultationPrice: 0, verificationStatus: 'APPROVED', isVerified: true } });
    const service = await prisma.service.create({ data: { name: 'Ajeno', price: 10, priceCents: 1000, duration: 30, doctorProfileId: otherDoctor.id } });
    await request(app).post('/api/bookings/book').set('Authorization', `Bearer ${patientToken}`)
      .send({ doctorId, clinicId, serviceId: service.id, date: '2026-08-02', startTime: '09:00', paymentMethod: 'CASH' }).expect(403);
  });

  it('permite una sola reserva simultánea para el mismo intervalo', async () => {
    const service = await prisma.service.create({ data: { name: 'Concurrente', price: 10, priceCents: 1000, duration: 30, doctorProfileId: doctorId } });
    const body = { doctorId, clinicId, serviceId: service.id, startsAt: '2026-08-03T09:00:00-05:00', paymentMethod: 'CASH' };
    const results = await Promise.all([request(app).post('/api/bookings/book').set('Authorization', `Bearer ${patientToken}`).send(body), request(app).post('/api/bookings/book').set('Authorization', `Bearer ${patientToken}`).send(body)]);
    expect(results.map(r => r.status).sort()).toEqual([201, 409]);
    expect(await prisma.appointment.count({ where: { doctorProfileId: doctorId, startsAt: new Date('2026-08-03T14:00:00.000Z') } })).toBe(1);
  });

  it('cancela y reprograma con historial real sin alterar snapshots', async () => {
    const service = await prisma.service.create({ data: { name: 'Reprogramable', price: 20, priceCents: 2000, duration: 30, doctorProfileId: doctorId } });
    const created = await request(app).post('/api/bookings/book').set('Authorization', `Bearer ${patientToken}`).send({ doctorId, clinicId, serviceId: service.id, startsAt: '2026-08-04T09:00:00-05:00', paymentMethod: 'CASH' }).expect(201);
    const moved = await request(app).patch(`/api/bookings/${created.body.id}/reschedule`).set('Authorization', `Bearer ${patientToken}`).send({ startsAt: '2026-08-04T10:00:00-05:00' }).expect(200);
    expect(moved.body).toMatchObject({ servicePriceCentsSnapshot: 2000, startTime: '10:00' });
    expect(await prisma.appointmentChangeLog.count({ where: { appointmentId: created.body.id, changeType: 'RESCHEDULED' } })).toBe(1);
    await request(app).patch(`/api/bookings/${created.body.id}/cancel`).set('Authorization', `Bearer ${patientToken}`).send({ reason: 'Prueba' }).expect(200);
    expect(await prisma.appointment.findUnique({ where: { id: created.body.id } })).toMatchObject({ status: 'CANCELLED', cancelledByUserId: patientId });
    expect(await prisma.appointmentChangeLog.count({ where: { appointmentId: created.body.id, changeType: 'CANCELLED' } })).toBe(1);
  });
});
