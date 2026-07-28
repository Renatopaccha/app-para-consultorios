import request from 'supertest';

process.env.JWT_SECRET = 'i'.repeat(32);
process.env.CORS_ORIGIN = 'http://frontend.test';

jest.mock('./prisma', () => ({
  __esModule: true,
  default: {
    user: { findUnique: jest.fn() },
    invitation: { findFirst: jest.fn(), create: jest.fn() },
  },
}));

jest.mock('./services/email.service', () => ({
  emailService: { sendInvitationEmail: jest.fn().mockResolvedValue(undefined) },
}));

jest.mock('./jobs/reminder.job', () => ({}));

import prisma from './prisma';
import app from './app';
import { generateToken } from './utils/jwt';

const prismaMock = prisma as unknown as {
  user: { findUnique: jest.Mock };
  invitation: { findFirst: jest.Mock; create: jest.Mock };
};

beforeEach(() => {
  jest.clearAllMocks();
});

describe('invitation HTTP boundary', () => {
  it('rejects an unauthenticated invitation request', async () => {
    const response = await request(app).post('/api/admin/invitations').send({ email: 'doctor@example.test', role: 'DOCTOR' });
    expect(response.status).toBe(401);
  });

  it('rejects a patient invitation request through real middleware', async () => {
    const token = generateToken({ id: 'patient-1', role: 'PATIENT' });
    const response = await request(app).post('/api/admin/invitations').set('Authorization', `Bearer ${token}`).send({ email: 'doctor@example.test', role: 'DOCTOR' });
    expect(response.status).toBe(403);
  });

  it('allows a super admin to create a doctor invitation without exposing the hash', async () => {
    prismaMock.user.findUnique.mockResolvedValue(null);
    prismaMock.invitation.findFirst.mockResolvedValue(null);
    prismaMock.invitation.create.mockResolvedValue({ id: 'invite-1', email: 'doctor@example.test', role: 'DOCTOR', clinicProfileId: null, expiresAt: new Date(), createdAt: new Date() });
    const token = generateToken({ id: 'admin-1', role: 'SUPER_ADMIN' });
    const response = await request(app).post('/api/admin/invitations').set('Authorization', `Bearer ${token}`).send({ email: ' Doctor@Example.Test ', role: 'DOCTOR' });
    expect(response.status).toBe(201);
    expect(response.body.invitation.email).toBe('doctor@example.test');
    expect(response.body.invitation.tokenHash).toBeUndefined();
    expect(response.body.developmentToken).toBeTruthy();
    expect(prismaMock.invitation.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ email: 'doctor@example.test', tokenHash: expect.any(String) }) }));
  });

  it('never exposes an invitation token in production responses', async () => {
    const originalEnvironment = process.env.NODE_ENV;
    process.env.NODE_ENV = 'production';
    prismaMock.user.findUnique.mockResolvedValue(null);
    prismaMock.invitation.findFirst.mockResolvedValue(null);
    prismaMock.invitation.create.mockResolvedValue({ id: 'invite-production', email: 'doctor@example.test', role: 'DOCTOR', clinicProfileId: null, expiresAt: new Date(), createdAt: new Date() });
    const token = generateToken({ id: 'admin-1', role: 'SUPER_ADMIN' });
    const response = await request(app).post('/api/admin/invitations').set('Authorization', `Bearer ${token}`).send({ email: 'doctor@example.test', role: 'DOCTOR' });
    expect(response.status).toBe(201);
    expect(response.body.developmentToken).toBeUndefined();
    process.env.NODE_ENV = originalEnvironment;
  });
});
