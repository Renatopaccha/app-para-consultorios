process.env.JWT_SECRET = 'test-jwt-secret-that-is-long-enough-for-link-tests';

jest.mock('newrelic', () => ({}));

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

jest.mock('./services/clerkSession.service', () => ({
  clerkSessionMiddleware: () => (_req: unknown, _res: unknown, next: () => void) => next(),
  resolveClerkSession: jest.fn(),
  resolveVerifiedClerkIdentity: jest.fn(),
}));

jest.mock('./services/legacyCredential.service', () => ({
  verifyLegacyPassword: jest.fn(),
}));

jest.mock('./services/authIdentityLink.service', () => {
  class AuthIdentityLinkError extends Error {}
  return {
    AuthIdentityLinkError,
    linkClerkIdentity: jest.fn(),
    recordIdentityLinkAudit: jest.fn(),
  };
});

import request from 'supertest';
import app from './app';
import prisma from './prisma';
import { resolveVerifiedClerkIdentity } from './services/clerkSession.service';
import { verifyLegacyPassword } from './services/legacyCredential.service';
import { linkClerkIdentity, recordIdentityLinkAudit } from './services/authIdentityLink.service';

const findUser = prisma.user.findUnique as jest.Mock;
const resolveIdentity = resolveVerifiedClerkIdentity as jest.Mock;
const verifyPassword = verifyLegacyPassword as jest.Mock;
const linkIdentity = linkClerkIdentity as jest.Mock;
const auditLink = recordIdentityLinkAudit as jest.Mock;

const userForRole = (role: 'DOCTOR' | 'CLINIC_ADMIN' | 'ASSISTANT' | 'PATIENT') => ({
  id: `user-${role.toLowerCase()}`,
  emailNormalized: 'owner@zenda.test',
  passwordHash: 'legacy-password-hash',
  clerkUserId: null,
  role,
});

describe('POST /api/auth/clerk/link-existing-account portal validation', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    resolveIdentity.mockResolvedValue({ clerkUserId: 'clerk-owner', sessionId: 'session-owner', email: 'owner@zenda.test' });
    verifyPassword.mockResolvedValue(true);
    linkIdentity.mockResolvedValue({ linkedNow: true });
    auditLink.mockResolvedValue(undefined);
  });

  it('links a DOCTOR from the professional portal', async () => {
    findUser.mockResolvedValue(userForRole('DOCTOR'));

    const response = await request(app)
      .post('/api/auth/clerk/link-existing-account')
      .send({ password: 'correct-password', portal: 'professional' });

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({ linked: true, user: { role: 'DOCTOR' } });
    expect(linkIdentity).toHaveBeenCalledWith({ userId: 'user-doctor', actorUserId: 'user-doctor', clerkUserId: 'clerk-owner' });
  });

  it('rejects a PATIENT from the professional portal without linking or revealing its role', async () => {
    findUser.mockResolvedValue(userForRole('PATIENT'));

    const response = await request(app)
      .post('/api/auth/clerk/link-existing-account')
      .send({ password: 'correct-password', portal: 'professional' });

    expect(response.status).toBe(403);
    expect(response.body).toEqual({ error: 'Esta cuenta no corresponde al portal solicitado.', code: 'PORTAL_ROLE_MISMATCH' });
    expect(JSON.stringify(response.body)).not.toContain('PATIENT');
    expect(linkIdentity).not.toHaveBeenCalled();
  });

  it('rejects a CLINIC_ADMIN from the assistant portal without linking', async () => {
    findUser.mockResolvedValue(userForRole('CLINIC_ADMIN'));

    const response = await request(app)
      .post('/api/auth/clerk/link-existing-account')
      .send({ password: 'correct-password', portal: 'assistant' });

    expect(response.status).toBe(403);
    expect(response.body.code).toBe('PORTAL_ROLE_MISMATCH');
    expect(JSON.stringify(response.body)).not.toContain('CLINIC_ADMIN');
    expect(linkIdentity).not.toHaveBeenCalled();
  });

  it('rejects an unsupported portal with a clear 400 before account lookup', async () => {
    const response = await request(app)
      .post('/api/auth/clerk/link-existing-account')
      .send({ password: 'correct-password', portal: 'patient' });

    expect(response.status).toBe(400);
    expect(response.body).toEqual({ error: 'El portal solicitado no es válido.', code: 'LINK_PORTAL_INVALID' });
    expect(resolveIdentity).not.toHaveBeenCalled();
    expect(findUser).not.toHaveBeenCalled();
    expect(linkIdentity).not.toHaveBeenCalled();
  });
});
