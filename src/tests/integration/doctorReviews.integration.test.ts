import request from 'supertest';
import app from '../../app';
import prisma, { disconnectPrisma } from '../../prisma';
import { generateToken } from '../../utils/jwt';
import { assertIntegrationDatabase, clearIntegrationDatabase } from './testDatabase';

async function createUser(email: string, role: 'DOCTOR' | 'PATIENT' | 'CLINIC_ADMIN') {
  return prisma.user.create({
    data: { email, emailNormalized: email, firstName: 'NombrePrivado', lastName: 'ApellidoPrivado', phone: '+593999999999', passwordHash: 'test-only', role },
  });
}

async function createAppointment(input: {
  patientId: string;
  doctorProfileId: string;
  clinicProfileId: string;
  serviceId: string;
  status: 'COMPLETED' | 'CONFIRMED';
  day: number;
}) {
  const startsAt = new Date(Date.UTC(2026, 6, input.day, 15, 0));
  return prisma.appointment.create({
    data: {
      patientId: input.patientId,
      doctorProfileId: input.doctorProfileId,
      clinicProfileId: input.clinicProfileId,
      serviceId: input.serviceId,
      date: startsAt,
      startTime: '10:00',
      endTime: '10:30',
      startDatetime: startsAt,
      startsAt,
      endsAt: new Date(startsAt.getTime() + 30 * 60_000),
      status: input.status,
      paymentMethod: 'NONE',
      paymentStatus: 'PAID',
      serviceNameSnapshot: 'Consulta privada',
      servicePriceCentsSnapshot: 3500,
      serviceDurationMinutesSnapshot: 30,
      currencySnapshot: 'USD',
      paymentAmountCents: 3500,
      paymentCurrency: 'USD',
    },
  });
}

describe('reseñas reales del doctor con PostgreSQL', () => {
  beforeEach(async () => { assertIntegrationDatabase(); await clearIntegrationDatabase(); });
  afterAll(async () => { await clearIntegrationDatabase(); await disconnectPrisma(); });

  it('aísla al doctor, agrega métricas, pagina, filtra por sede y no expone al paciente', async () => {
    const [doctorUser, otherDoctorUser, patient, clinicOwner, otherClinicOwner] = await Promise.all([
      createUser('reviews-doctor@zenda.test', 'DOCTOR'),
      createUser('reviews-other@zenda.test', 'DOCTOR'),
      createUser('reviews-patient@zenda.test', 'PATIENT'),
      createUser('reviews-clinic@zenda.test', 'CLINIC_ADMIN'),
      createUser('reviews-other-clinic@zenda.test', 'CLINIC_ADMIN'),
    ]);
    const doctor = await prisma.doctorProfile.create({ data: { userId: doctorUser.id, licenseNumber: 'REV-1', consultationPrice: 35 } });
    const otherDoctor = await prisma.doctorProfile.create({ data: { userId: otherDoctorUser.id, licenseNumber: 'REV-2', consultationPrice: 35 } });
    const clinic = await prisma.clinicProfile.create({ data: { userId: clinicOwner.id, name: 'Sede Centro', address: 'Dirección privada' } });
    const otherClinic = await prisma.clinicProfile.create({ data: { userId: otherClinicOwner.id, name: 'Sede Norte', address: 'Dirección privada' } });
    await prisma.doctorClinicWorkplace.createMany({ data: [
      { doctorProfileId: doctor.id, clinicProfileId: clinic.id },
      { doctorProfileId: doctor.id, clinicProfileId: otherClinic.id },
      { doctorProfileId: otherDoctor.id, clinicProfileId: otherClinic.id },
    ] });
    const service = await prisma.service.create({ data: { name: 'Consulta', doctorProfileId: doctor.id, price: 35, priceCents: 3500, duration: 30 } });
    const otherService = await prisma.service.create({ data: { name: 'Consulta ajena', doctorProfileId: otherDoctor.id, price: 35, priceCents: 3500, duration: 30 } });
    const appointments = await Promise.all([
      createAppointment({ patientId: patient.id, doctorProfileId: doctor.id, clinicProfileId: clinic.id, serviceId: service.id, status: 'COMPLETED', day: 1 }),
      createAppointment({ patientId: patient.id, doctorProfileId: doctor.id, clinicProfileId: clinic.id, serviceId: service.id, status: 'COMPLETED', day: 2 }),
      createAppointment({ patientId: patient.id, doctorProfileId: doctor.id, clinicProfileId: otherClinic.id, serviceId: service.id, status: 'COMPLETED', day: 3 }),
      createAppointment({ patientId: patient.id, doctorProfileId: otherDoctor.id, clinicProfileId: otherClinic.id, serviceId: otherService.id, status: 'COMPLETED', day: 4 }),
    ]);
    await Promise.all([
      prisma.review.create({ data: { appointmentId: appointments[0].id, patientId: patient.id, doctorProfileId: doctor.id, rating: 5, comment: 'Excelente' } }),
      prisma.review.create({ data: { appointmentId: appointments[1].id, patientId: patient.id, doctorProfileId: doctor.id, rating: 3, comment: null } }),
      prisma.review.create({ data: { appointmentId: appointments[2].id, patientId: patient.id, doctorProfileId: doctor.id, rating: 4, comment: 'Muy bien' } }),
      prisma.review.create({ data: { appointmentId: appointments[3].id, patientId: patient.id, doctorProfileId: otherDoctor.id, rating: 1, comment: 'No visible' } }),
    ]);

    const token = generateToken({ id: doctorUser.id, role: 'DOCTOR' });
    const firstPage = await request(app).get('/api/doctors/me/reviews').query({ page: 1, pageSize: 2 }).set('Authorization', `Bearer ${token}`).expect(200);
    expect(firstPage.body.summary).toEqual({ averageRating: 4, totalReviews: 3, distribution: { one: 0, two: 0, three: 1, four: 1, five: 1 } });
    expect(firstPage.body.pagination).toEqual({ page: 1, pageSize: 2, totalItems: 3, totalPages: 2 });
    expect(firstPage.body.items).toHaveLength(2);
    expect(firstPage.body.items.every((item: { patientDisplayName: string }) => item.patientDisplayName === 'Paciente verificado')).toBe(true);
    const serialized = JSON.stringify(firstPage.body);
    for (const privateValue of ['reviews-patient@zenda.test', '+593999999999', 'NombrePrivado', 'ApellidoPrivado', 'Dirección privada', appointments[0].id, patient.id]) {
      expect(serialized).not.toContain(privateValue);
    }
    expect(serialized).not.toContain('No visible');

    const clinicFilter = await request(app).get('/api/doctors/me/reviews').query({ clinicId: clinic.id }).set('Authorization', `Bearer ${token}`).expect(200);
    expect(clinicFilter.body.summary).toMatchObject({ averageRating: 4, totalReviews: 2 });
    expect(clinicFilter.body.items.every((item: { clinicName: string }) => item.clinicName === 'Sede Centro')).toBe(true);

    const otherToken = generateToken({ id: otherDoctorUser.id, role: 'DOCTOR' });
    const isolated = await request(app).get('/api/doctors/me/reviews').set('Authorization', `Bearer ${otherToken}`).expect(200);
    expect(isolated.body.summary.totalReviews).toBe(1);
    expect(isolated.body.items[0].comment).toBe('No visible');
    await request(app).get('/api/doctors/me/reviews').set('Authorization', `Bearer ${generateToken({ id: patient.id, role: 'PATIENT' })}`).expect(403);
    await request(app).get('/api/doctors/me/reviews').set('Authorization', `Bearer ${generateToken({ id: clinicOwner.id, role: 'CLINIC_ADMIN' })}`).expect(403);
  });

  it('solo permite una reseña del paciente para una cita completada', async () => {
    const [doctorUser, patient, clinicOwner] = await Promise.all([
      createUser('create-review-doctor@zenda.test', 'DOCTOR'),
      createUser('create-review-patient@zenda.test', 'PATIENT'),
      createUser('create-review-clinic@zenda.test', 'CLINIC_ADMIN'),
    ]);
    const doctor = await prisma.doctorProfile.create({ data: { userId: doctorUser.id, licenseNumber: 'REV-POST', consultationPrice: 35 } });
    const clinic = await prisma.clinicProfile.create({ data: { userId: clinicOwner.id, name: 'Sede', address: 'Quito' } });
    const service = await prisma.service.create({ data: { name: 'Consulta', doctorProfileId: doctor.id, price: 35, priceCents: 3500, duration: 30 } });
    const pending = await createAppointment({ patientId: patient.id, doctorProfileId: doctor.id, clinicProfileId: clinic.id, serviceId: service.id, status: 'CONFIRMED', day: 5 });
    const completed = await createAppointment({ patientId: patient.id, doctorProfileId: doctor.id, clinicProfileId: clinic.id, serviceId: service.id, status: 'COMPLETED', day: 6 });
    const token = generateToken({ id: patient.id, role: 'PATIENT' });

    const incomplete = await request(app).post('/api/reviews').set('Authorization', `Bearer ${token}`).send({ appointmentId: pending.id, rating: 5 }).expect(400);
    expect(incomplete.body.error).toBe('APPOINTMENT_NOT_COMPLETED');
    const created = await request(app).post('/api/reviews').set('Authorization', `Bearer ${token}`).send({ appointmentId: completed.id, rating: 5, comment: 'Atención real' }).expect(201);
    expect(created.body.review).toEqual(expect.objectContaining({ rating: 5, comment: 'Atención real' }));
    expect(created.body.review).not.toHaveProperty('patientId');
    const duplicate = await request(app).post('/api/reviews').set('Authorization', `Bearer ${token}`).send({ appointmentId: completed.id, rating: 4 }).expect(409);
    expect(duplicate.body.error).toBe('REVIEW_ALREADY_EXISTS');
    expect(await prisma.review.count({ where: { appointmentId: completed.id } })).toBe(1);
  });
});
