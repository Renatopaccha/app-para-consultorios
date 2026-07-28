process.env.JWT_SECRET = 'test-jwt-secret-that-is-long-enough-for-unit-tests';

jest.mock('./prisma', () => ({
  __esModule: true,
  default: { user: { findUnique: jest.fn() } },
}));

jest.mock('./services/email.service', () => ({
  emailService: {
    sendWelcomeEmail: jest.fn(),
    sendEmailVerificationEmail: jest.fn(),
    sendPatientInvitationEmail: jest.fn(),
    sendPasswordReset: jest.fn(),
    sendInvitationEmail: jest.fn(),
  },
}));

import request from 'supertest';
import app from './app';
import prisma from './prisma';
import { generateToken } from './utils/jwt';

const prismaMock = prisma as unknown as { user: { findUnique: jest.Mock } };

describe('GET /api/auth/me', () => {
  beforeEach(() => jest.clearAllMocks());

  it('requires a valid JWT and returns only the authenticated session DTO', async () => {
    prismaMock.user.findUnique.mockResolvedValue({
      id: 'doctor-user', email: 'doctor@example.test', firstName: 'Ada', lastName: 'Doctor', phone: null, role: 'DOCTOR',
      doctorProfile: { id: 'doctor-profile' }, clinicProfile: null, assistantProfile: null,
    });
    const token = generateToken({ id: 'doctor-user', role: 'DOCTOR' });

    const response = await request(app).get('/api/auth/me').set('Authorization', `Bearer ${token}`);

    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      id: 'doctor-user', email: 'doctor@example.test', firstName: 'Ada', lastName: 'Doctor', phone: null, role: 'DOCTOR',
      profile: { doctorProfileId: 'doctor-profile' },
    });
    expect(response.body).not.toHaveProperty('passwordHash');
  });

  it('rejects missing or invalid tokens', async () => {
    await request(app).get('/api/auth/me').expect(401);
    await request(app).get('/api/auth/me').set('Authorization', 'Bearer invalid').expect(401);
  });
});
