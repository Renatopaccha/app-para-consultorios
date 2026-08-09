process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = 'test-jwt-secret-that-is-long-enough-for-unit-tests';
process.env.CLERK_PUBLISHABLE_KEY = 'pk_test_placeholder';
process.env.CLERK_SECRET_KEY = 'sk_test_placeholder';

jest.mock('@clerk/express', () => ({
  clerkMiddleware: jest.fn(() => (_req: unknown, _res: unknown, next: () => void) => next()),
  getAuth: jest.fn(() => ({ isAuthenticated: false })),
}));
jest.mock('./prisma', () => ({
  __esModule: true,
  default: { user: { findUnique: jest.fn() } },
}));
jest.mock('./services/email.service', () => ({
  emailService: { sendWelcomeEmail: jest.fn(), sendEmailVerificationEmail: jest.fn(), sendPatientInvitationEmail: jest.fn(), sendPasswordReset: jest.fn(), sendInvitationEmail: jest.fn() },
}));

import bcrypt from 'bcrypt';
import request from 'supertest';
import app from './app';
import prisma from './prisma';
import { generateToken } from './utils/jwt';

const prismaMock = prisma as unknown as { user: { findUnique: jest.Mock } };

describe('compatibilidad HTTP legacy con Clerk configurado', () => {
  beforeEach(() => jest.clearAllMocks());

  it('allows legacy email/password login when no Clerk session is present', async () => {
    const passwordHash = await bcrypt.hash('legacy-password-123', 4);
    prismaMock.user.findUnique.mockResolvedValue({ id: 'legacy-user', email: 'doctor@zenda.test', emailNormalized: 'doctor@zenda.test', firstName: 'Legacy', lastName: 'Doctor', passwordHash, role: 'DOCTOR' });
    const response = await request(app).post('/api/auth/login').send({ email: 'doctor@zenda.test', password: 'legacy-password-123' }).expect(200);
    expect(response.body).toMatchObject({ token: expect.any(String), user: { id: 'legacy-user', role: 'DOCTOR' } });
    expect(JSON.stringify(response.body)).not.toContain('sk_test_placeholder');
  });

  it('maps a legacy JWT to the database user even when Clerk reports no session', async () => {
    prismaMock.user.findUnique.mockResolvedValue({
      id: 'legacy-user', email: 'legacy@zenda.test', firstName: 'Legacy', lastName: 'Doctor', phone: null, role: 'DOCTOR',
      doctorProfile: null, clinicProfile: null, assistantProfile: null,
    });
    const response = await request(app).get('/api/auth/me').set('Authorization', `Bearer ${generateToken({ id: 'legacy-user', role: 'PATIENT' })}`).expect(200);
    expect(response.body).toMatchObject({ id: 'legacy-user', role: 'DOCTOR' });
  });
});
