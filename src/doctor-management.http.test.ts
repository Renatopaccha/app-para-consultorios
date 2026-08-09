process.env.JWT_SECRET = 'test-jwt-secret-that-is-long-enough-for-unit-tests';

jest.mock('./prisma', () => ({
  __esModule: true,
  default: {
    user: { findUnique: jest.fn() },
    doctorProfile: { findUnique: jest.fn(), findMany: jest.fn(), update: jest.fn() },
    specialty: { findMany: jest.fn(), count: jest.fn() },
    insurance: { findMany: jest.fn(), count: jest.fn() },
    doctorClinicWorkplace: { findUnique: jest.fn() },
    service: { findMany: jest.fn(), findFirst: jest.fn(), create: jest.fn(), update: jest.fn() },
    $transaction: jest.fn(),
  },
}));
jest.mock('./services/email.service', () => ({ emailService: { sendWelcomeEmail: jest.fn(), sendEmailVerificationEmail: jest.fn(), sendPatientInvitationEmail: jest.fn(), sendPasswordReset: jest.fn(), sendInvitationEmail: jest.fn() } }));

import request from 'supertest';
import app from './app';
import prisma from './prisma';
import { generateToken } from './utils/jwt';

const prismaMock = prisma as unknown as { user: { findUnique: jest.Mock }; doctorProfile: { findUnique: jest.Mock }; specialty: { findMany: jest.Mock }; insurance: { findMany: jest.Mock } };

beforeEach(() => {
  jest.clearAllMocks();
  prismaMock.user.findUnique.mockImplementation(({ where }: { where: { id?: string } }) => Promise.resolve(
    where.id === 'patient-user' ? { id: 'patient-user', role: 'PATIENT' } : { id: 'doctor-user', role: 'DOCTOR' },
  ));
  prismaMock.doctorProfile.findUnique.mockImplementation(({ where }: { where: { userId?: string } }) => Promise.resolve({
    id: 'doctor-profile', userId: 'doctor-user', licenseNumber: 'MED-1', bio: null, languages: [], profileImageUrl: null, specialties: [], insurances: [],
    user: { id: 'doctor-user', email: 'doctor@example.test', firstName: 'Ada', lastName: 'Doctor', phone: null },
    ...(where.userId ? {} : {}),
  }));
  prismaMock.specialty.findMany.mockResolvedValue([]);
  prismaMock.insurance.findMany.mockResolvedValue([]);
});

describe('doctor profile HTTP authorization', () => {
  it('returns 401 without a session', async () => { await request(app).get('/api/doctors/me/profile').expect(401); });
  it('returns 403 for a non-doctor role', async () => { const token = generateToken({ id: 'patient-user', role: 'PATIENT' }); await request(app).get('/api/doctors/me/profile').set('Authorization', `Bearer ${token}`).expect(403); });
  it('returns the authenticated doctor profile', async () => { const token = generateToken({ id: 'doctor-user', role: 'DOCTOR' }); const response = await request(app).get('/api/doctors/me/profile').set('Authorization', `Bearer ${token}`).expect(200); expect(response.body).toEqual(expect.objectContaining({ id: 'doctor-profile', email: 'doctor@example.test' })); });
});
