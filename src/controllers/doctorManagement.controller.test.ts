jest.mock('../prisma', () => ({
  __esModule: true,
  default: {
    doctorProfile: { findUnique: jest.fn(), update: jest.fn() },
    specialty: { findMany: jest.fn(), count: jest.fn() },
    insurance: { findMany: jest.fn(), count: jest.fn() },
    doctorClinicWorkplace: { findUnique: jest.fn() },
    service: { findMany: jest.fn(), findFirst: jest.fn(), create: jest.fn(), update: jest.fn() },
    $transaction: jest.fn(),
  },
}));

import type { Response } from 'express';
import prisma from '../prisma';
import { createMyDoctorService, getMyDoctorProfile, patchMyDoctorProfile, patchMyDoctorServiceStatus } from './doctorManagement.controller';

const prismaMock = prisma as unknown as {
  doctorProfile: { findUnique: jest.Mock; update: jest.Mock };
  specialty: { findMany: jest.Mock; count: jest.Mock };
  insurance: { findMany: jest.Mock; count: jest.Mock };
  doctorClinicWorkplace: { findUnique: jest.Mock };
  service: { findMany: jest.Mock; findFirst: jest.Mock; create: jest.Mock; update: jest.Mock };
  $transaction: jest.Mock;
};
const doctor = { id: 'doctor-profile', userId: 'doctor-user', licenseNumber: 'MED-1', bio: null, languages: [], profileImageUrl: null, user: { id: 'doctor-user', firstName: 'Ada', lastName: 'Doctor', email: 'doctor@example.test', phone: null } };

function response() {
  const result = { status: jest.fn(), json: jest.fn() } as unknown as Response;
  jest.mocked(result.status).mockReturnValue(result);
  return result;
}

beforeEach(() => {
  jest.clearAllMocks();
  prismaMock.doctorProfile.findUnique.mockResolvedValue({ ...doctor, specialties: [], insurances: [] });
  prismaMock.specialty.findMany.mockResolvedValue([]); prismaMock.insurance.findMany.mockResolvedValue([]);
  prismaMock.specialty.count.mockResolvedValue(0); prismaMock.insurance.count.mockResolvedValue(0);
});

describe('doctor management DTOs', () => {
  it('returns only the own doctor profile DTO', async () => {
    const res = response();
    await getMyDoctorProfile({ user: { id: 'doctor-user', role: 'DOCTOR' } } as never, res);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ id: 'doctor-profile', email: 'doctor@example.test', licenseNumber: 'MED-1' }));
    expect(res.json).not.toHaveBeenCalledWith(expect.objectContaining({ passwordHash: expect.anything() }));
  });

  it('does not persist protected profile fields supplied by a doctor', async () => {
    const res = response();
    const userUpdate = jest.fn(); const doctorUpdate = jest.fn();
    prismaMock.$transaction.mockImplementation(async (callback: (tx: { user: { update: jest.Mock }; doctorProfile: { update: jest.Mock } }) => unknown) => callback({ user: { update: userUpdate }, doctorProfile: { update: doctorUpdate } }));
    await patchMyDoctorProfile({ user: { id: 'doctor-user', role: 'DOCTOR' }, body: { firstName: 'Ada', role: 'SUPER_ADMIN', isVerified: true, verificationStatus: 'APPROVED' } } as never, res);
    expect(userUpdate).toHaveBeenCalledWith(expect.objectContaining({ data: { firstName: 'Ada' } }));
    expect(doctorUpdate).toHaveBeenCalledWith(expect.objectContaining({ data: {} }));
    expect(userUpdate.mock.calls[0][0].data).not.toHaveProperty('role');
  });

  it('creates a service with integer priceCents only', async () => {
    const res = response();
    prismaMock.doctorClinicWorkplace.findUnique.mockResolvedValue(null);
    prismaMock.service.create.mockResolvedValue({ id: 'service-1', name: 'Consulta', description: null, priceCents: 1250, currency: 'USD', duration: 30, isActive: true, clinicProfileId: null });
    await createMyDoctorService({ user: { id: 'doctor-user', role: 'DOCTOR' }, body: { name: 'Consulta', priceCents: 1250, durationMinutes: 30 } } as never, res);
    expect(prismaMock.service.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ priceCents: 1250, price: 12.5, doctorProfileId: 'doctor-profile' }) }));
    expect(res.status).toHaveBeenCalledWith(201);
  });

  it.each([{ priceCents: -1, durationMinutes: 30 }, { priceCents: 500, durationMinutes: 0 }])('rejects invalid money or duration', async (body) => {
    const res = response();
    await createMyDoctorService({ user: { id: 'doctor-user', role: 'DOCTOR' }, body: { name: 'Consulta', ...body } } as never, res);
    expect(res.status).toHaveBeenCalledWith(422);
    expect(prismaMock.service.create).not.toHaveBeenCalled();
  });

  it('does not change the status of a service owned by another doctor', async () => {
    const res = response();
    prismaMock.service.findFirst.mockResolvedValue(null);
    await patchMyDoctorServiceStatus({ user: { id: 'doctor-user', role: 'DOCTOR' }, params: { serviceId: 'other-service' }, body: { isActive: false } } as never, res);
    expect(res.status).toHaveBeenCalledWith(404);
    expect(prismaMock.service.update).not.toHaveBeenCalled();
  });
});
