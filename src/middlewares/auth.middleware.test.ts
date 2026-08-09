process.env.JWT_SECRET = 'test-jwt-secret-that-is-long-enough-for-unit-tests';

jest.mock('../prisma', () => ({
  __esModule: true,
  default: { user: { findUnique: jest.fn() } },
}));
jest.mock('../services/clerkSession.service', () => ({
  resolveClerkSession: jest.fn(),
}));
jest.mock('../services/clerkMfa.service', () => ({
  requiresMfa: jest.fn((role: string) => ['DOCTOR', 'CLINIC_ADMIN', 'ASSISTANT', 'SUPER_ADMIN'].includes(role)),
  getClerkMfaStatus: jest.fn(),
}));

import type { NextFunction, Response } from 'express';
import prisma from '../prisma';
import { resolveClerkSession } from '../services/clerkSession.service';
import { getClerkMfaStatus } from '../services/clerkMfa.service';
import { authenticate, type AuthRequest } from './auth.middleware';
import { generateToken } from '../utils/jwt';

const prismaMock = prisma as unknown as { user: { findUnique: jest.Mock } };
const clerkMock = jest.mocked(resolveClerkSession);
const clerkMfaMock = jest.mocked(getClerkMfaStatus);

function response() {
  const result = { status: jest.fn(), json: jest.fn() } as unknown as Response;
  jest.mocked(result.status).mockReturnValue(result);
  return result;
}

async function run(request: Partial<AuthRequest>) {
  const req = { headers: {}, ...request } as AuthRequest;
  const res = response();
  const next = jest.fn() as NextFunction;
  await authenticate(req, res, next);
  return { req, res, next };
}

describe('dual authentication adapter', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    clerkMock.mockReturnValue(null);
    clerkMfaMock.mockResolvedValue({ enabled: true, totpEnabled: true, backupCodeEnabled: true });
  });

  it('keeps a valid legacy JWT but resolves the current role from PostgreSQL', async () => {
    prismaMock.user.findUnique.mockResolvedValue({ id: 'zenda-1', role: 'PATIENT' });
    const token = generateToken({ id: 'zenda-1', role: 'DOCTOR' });
    const { req, next } = await run({ headers: { authorization: `Bearer ${token}` } });
    expect(next).toHaveBeenCalledTimes(1);
    expect(req.user).toEqual({ id: 'zenda-1', role: 'PATIENT' });
    expect(req.authSource).toBe('legacy_jwt');
  });

  it('rejects an invalid legacy JWT with 401', async () => {
    const { res, next } = await run({ headers: { authorization: 'Bearer invalid' } });
    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(401);
  });

  it('maps a linked Clerk session to the same internal UUID and database role', async () => {
    clerkMock.mockReturnValue({ clerkUserId: 'user_clerk_1', sessionId: 'sess_1' });
    prismaMock.user.findUnique.mockResolvedValue({ id: 'zenda-1', role: 'DOCTOR' });
    const { req, next } = await run({ body: { clerkUserId: 'user_attacker' } });
    expect(next).toHaveBeenCalledTimes(1);
    expect(req.user).toEqual({ id: 'zenda-1', role: 'DOCTOR' });
    expect(req.authSource).toBe('clerk');
    expect(prismaMock.user.findUnique).toHaveBeenCalledWith({ where: { clerkUserId: 'user_clerk_1' }, select: { id: true, role: true } });
  });

  it('returns a controlled state and never creates a user for an unlinked Clerk identity', async () => {
    clerkMock.mockReturnValue({ clerkUserId: 'user_unlinked', sessionId: 'sess_1' });
    prismaMock.user.findUnique.mockResolvedValue(null);
    const { res, next } = await run({});
    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(403);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ code: 'CLERK_IDENTITY_NOT_LINKED' }));
  });

  it('rejects conflicting linked Clerk and legacy identities', async () => {
    clerkMock.mockReturnValue({ clerkUserId: 'user_clerk_b', sessionId: 'sess_b' });
    prismaMock.user.findUnique
      .mockResolvedValueOnce({ id: 'zenda-a', role: 'DOCTOR' })
      .mockResolvedValueOnce({ id: 'zenda-b', role: 'PATIENT' });
    const token = generateToken({ id: 'zenda-a', role: 'DOCTOR' });
    const { res, next } = await run({ headers: { authorization: `Bearer ${token}` } });
    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ code: 'AUTH_IDENTITY_CONFLICT' }));
  });

  it('uses a newly changed database role on the next request', async () => {
    const token = generateToken({ id: 'zenda-1', role: 'DOCTOR' });
    prismaMock.user.findUnique.mockResolvedValueOnce({ id: 'zenda-1', role: 'DOCTOR' }).mockResolvedValueOnce({ id: 'zenda-1', role: 'PATIENT' });
    expect((await run({ headers: { authorization: `Bearer ${token}` } })).req.user?.role).toBe('DOCTOR');
    expect((await run({ headers: { authorization: `Bearer ${token}` } })).req.user?.role).toBe('PATIENT');
  });

  it.each(['DOCTOR', 'CLINIC_ADMIN', 'ASSISTANT', 'SUPER_ADMIN'] as const)('requires Clerk MFA for %s', async (role) => {
    clerkMock.mockReturnValue({ clerkUserId: `user_${role}`, sessionId: 'sess_1' });
    clerkMfaMock.mockResolvedValue({ enabled: false, totpEnabled: false, backupCodeEnabled: false });
    prismaMock.user.findUnique.mockResolvedValue({ id: 'zenda-professional', role });

    const { res, next } = await run({});
    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(403);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ code: 'MFA_SETUP_REQUIRED', mfa: { required: true, enabled: false } }));
  });

  it('allows a PATIENT without MFA and never trusts request fields or Clerk metadata for the policy', async () => {
    clerkMock.mockReturnValue({ clerkUserId: 'user_patient', sessionId: 'sess_1' });
    prismaMock.user.findUnique.mockResolvedValue({ id: 'zenda-patient', role: 'PATIENT' });

    const { req, next } = await run({ body: { role: 'DOCTOR', mfaEnabled: true }, query: { role: 'DOCTOR' } });
    expect(next).toHaveBeenCalledTimes(1);
    expect(req.user).toEqual({ id: 'zenda-patient', role: 'PATIENT' });
    expect(clerkMfaMock).not.toHaveBeenCalled();
  });

  it('fails closed for a Clerk professional when MFA status cannot be retrieved', async () => {
    clerkMock.mockReturnValue({ clerkUserId: 'user_doctor', sessionId: 'sess_1' });
    prismaMock.user.findUnique.mockResolvedValue({ id: 'zenda-doctor', role: 'DOCTOR' });
    clerkMfaMock.mockRejectedValue(new Error('Clerk unavailable'));

    const { res, next } = await run({});
    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(503);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ code: 'MFA_STATUS_UNAVAILABLE' }));
  });
});
