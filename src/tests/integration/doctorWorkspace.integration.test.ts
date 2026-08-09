import request from 'supertest';
import app from '../../app';
import prisma, { disconnectPrisma } from '../../prisma';
import { generateToken } from '../../utils/jwt';
import { assertIntegrationDatabase, clearIntegrationDatabase } from './testDatabase';

async function createDoctor(email: string, licenseNumber: string, isIndependent = false) {
  const user = await prisma.user.create({
    data: {
      email,
      emailNormalized: email,
      firstName: 'Doctor',
      lastName: licenseNumber,
      passwordHash: 'test-only',
      role: 'DOCTOR',
    },
  });
  const doctor = await prisma.doctorProfile.create({
    data: { userId: user.id, licenseNumber, consultationPrice: 50, isIndependent },
  });
  return { user, doctor, token: generateToken({ id: user.id, role: 'DOCTOR' }) };
}

async function createClinic(email: string, name: string, type: 'CLINIC' | 'INDEPENDENT_PRACTICE' = 'CLINIC') {
  const owner = await prisma.user.create({
    data: { email, emailNormalized: email, firstName: name, lastName: 'Owner', passwordHash: 'test-only', role: 'CLINIC_ADMIN' },
  });
  return prisma.clinicProfile.create({ data: { userId: owner.id, name, address: 'Dirección de pruebas', type } });
}

describe('workspace operativo del doctor con PostgreSQL real', () => {
  beforeEach(async () => { assertIntegrationDatabase(); await clearIntegrationDatabase(); });
  afterAll(async () => { await clearIntegrationDatabase(); await disconnectPrisma(); });

  it('devuelve el consultorio independiente como sede operativa legible', async () => {
    const actor = await createDoctor('independent@zenda.test', 'WORK-I', true);
    const office = await prisma.clinicProfile.create({
      data: { userId: actor.user.id, name: 'Consultorio privado', address: 'Quito', type: 'INDEPENDENT_PRACTICE' },
    });
    await prisma.doctorClinicWorkplace.create({ data: { doctorProfileId: actor.doctor.id, clinicProfileId: office.id } });

    const response = await request(app).get('/api/doctors/me/workspaces').set('Authorization', `Bearer ${actor.token}`).expect(200);
    expect(response.body).toEqual({
      doctorProfileId: actor.doctor.id,
      mode: 'INDEPENDENT',
      selectedClinicId: null,
      locations: [{ id: office.id, name: 'Consultorio privado', type: 'INDEPENDENT_OFFICE', isActive: true }],
    });
  });

  it('devuelve solo clínicas activas del doctor y soporta múltiples sedes', async () => {
    const actor = await createDoctor('multi@zenda.test', 'WORK-M');
    const clinicA = await createClinic('clinic-a@zenda.test', 'Clínica A');
    const clinicB = await createClinic('clinic-b@zenda.test', 'Clínica B');
    const inactive = await createClinic('clinic-inactive@zenda.test', 'Clínica Inactiva');
    await prisma.doctorClinicWorkplace.createMany({ data: [
      { doctorProfileId: actor.doctor.id, clinicProfileId: clinicA.id, isActive: true },
      { doctorProfileId: actor.doctor.id, clinicProfileId: clinicB.id, isActive: true },
      { doctorProfileId: actor.doctor.id, clinicProfileId: inactive.id, isActive: false, leftAt: new Date() },
    ] });

    const response = await request(app).get('/api/doctors/me/workspaces').set('Authorization', `Bearer ${actor.token}`).expect(200);
    expect(response.body.locations).toEqual(expect.arrayContaining([
      { id: clinicA.id, name: 'Clínica A', type: 'CLINIC', isActive: true },
      { id: clinicB.id, name: 'Clínica B', type: 'CLINIC', isActive: true },
    ]));
    expect(response.body.locations).toHaveLength(2);

    const selected = await request(app).get('/api/doctors/me/workspaces').query({ clinicId: clinicB.id }).set('Authorization', `Bearer ${actor.token}`).expect(200);
    expect(selected.body).toMatchObject({ mode: 'CLINIC', selectedClinicId: clinicB.id });
  });

  it('no expone ni permite seleccionar una sede ajena', async () => {
    const actor = await createDoctor('scoped@zenda.test', 'WORK-S');
    const ownClinic = await createClinic('own@zenda.test', 'Clínica Propia');
    const foreignClinic = await createClinic('foreign@zenda.test', 'Clínica Ajena');
    await prisma.doctorClinicWorkplace.create({ data: { doctorProfileId: actor.doctor.id, clinicProfileId: ownClinic.id } });

    const response = await request(app).get('/api/doctors/me/workspaces').query({ clinicId: foreignClinic.id }).set('Authorization', `Bearer ${actor.token}`).expect(403);
    expect(response.body.error).toBe('CLINIC_NOT_LINKED');

    const all = await request(app).get('/api/doctors/me/workspaces').set('Authorization', `Bearer ${actor.token}`).expect(200);
    expect(all.body.locations).toEqual([{ id: ownClinic.id, name: 'Clínica Propia', type: 'CLINIC', isActive: true }]);
  });
});
