process.env.JWT_SECRET = 'test-jwt-secret-that-is-long-enough-for-unit-tests';
process.env.CLERK_WEBHOOK_SIGNING_SECRET = `whsec_${Buffer.from('zenda-clerk-webhook-unit-test-secret').toString('base64')}`;

jest.mock('newrelic', () => ({}));

jest.mock('./prisma', () => ({
  __esModule: true,
  default: {
    user: {
      create: jest.fn(),
      findUnique: jest.fn(),
    },
  },
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

import { createHmac } from 'crypto';
import request from 'supertest';
import { Prisma } from '../generated/prisma';
import app from './app';
import prisma from './prisma';

const prismaMock = prisma as unknown as {
  user: {
    create: jest.Mock;
    findUnique: jest.Mock;
  };
};

function userCreatedPayload(overrides: Record<string, unknown> = {}) {
  return JSON.stringify({
    type: 'user.created',
    object: 'event',
    data: {
      id: 'user_clerk_webhook_1',
      primary_email_address_id: 'idn_primary',
      email_addresses: [{
        id: 'idn_primary',
        email_address: 'New.Patient@Example.test',
        verification: { status: 'verified' },
      }],
      public_metadata: {},
      unsafe_metadata: {},
      ...overrides,
    },
  });
}

function signedHeaders(payload: string, id = 'msg_clerk_webhook_1') {
  const timestamp = Math.floor(Date.now() / 1000).toString();
  const secret = Buffer.from('zenda-clerk-webhook-unit-test-secret');
  const signature = createHmac('sha256', secret)
    .update(`${id}.${timestamp}.${payload}`)
    .digest('base64');
  return {
    'svix-id': id,
    'svix-timestamp': timestamp,
    'svix-signature': `v1,${signature}`,
  };
}

function uniqueConstraintError() {
  return new Prisma.PrismaClientKnownRequestError('Unique constraint failed', {
    code: 'P2002',
    clientVersion: 'test',
    meta: { target: ['clerkUserId'] },
  });
}

describe('POST /api/webhooks/clerk', () => {
  beforeEach(() => jest.clearAllMocks());

  it('rechaza una firma inválida sin crear User', async () => {
    const payload = userCreatedPayload();

    const response = await request(app)
      .post('/api/webhooks/clerk')
      .set('Content-Type', 'application/json')
      .set({ ...signedHeaders(payload), 'svix-signature': 'v1,invalid' })
      .send(payload);

    expect(response.status).toBe(400);
    expect(response.body).toEqual({ code: 'CLERK_WEBHOOK_INVALID_SIGNATURE', message: 'Webhook no válido.' });
    expect(prismaMock.user.create).not.toHaveBeenCalled();
  });

  it('crea un User PATIENT desde un evento user.created válido', async () => {
    prismaMock.user.create.mockResolvedValue({ id: 'zenda-user-1' });
    const payload = userCreatedPayload();

    const response = await request(app)
      .post('/api/webhooks/clerk')
      .set('Content-Type', 'application/json')
      .set(signedHeaders(payload))
      .send(payload);

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ received: true, created: true });
    expect(prismaMock.user.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        clerkUserId: 'user_clerk_webhook_1',
        email: 'new.patient@example.test',
        emailNormalized: 'new.patient@example.test',
        role: 'PATIENT',
      }),
    });
  });

  it('responde 200 al reintento del mismo evento sin crear una segunda fila', async () => {
    prismaMock.user.create.mockRejectedValue(uniqueConstraintError());
    prismaMock.user.findUnique.mockResolvedValue({ id: 'zenda-user-1' });
    const payload = userCreatedPayload();

    const response = await request(app)
      .post('/api/webhooks/clerk')
      .set('Content-Type', 'application/json')
      .set(signedHeaders(payload, 'msg_clerk_webhook_retry'))
      .send(payload);

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ received: true, duplicate: true });
    expect(prismaMock.user.findUnique).toHaveBeenCalledWith({
      where: { clerkUserId: 'user_clerk_webhook_1' },
      select: { id: true },
    });
  });

  it('ignora metadata que intenta escalar el rol y conserva PATIENT', async () => {
    prismaMock.user.create.mockResolvedValue({ id: 'zenda-user-1' });
    const payload = userCreatedPayload({
      public_metadata: { role: 'DOCTOR' },
      unsafe_metadata: { role: 'SUPER_ADMIN' },
      private_metadata: { role: 'CLINIC_ADMIN' },
    });

    const response = await request(app)
      .post('/api/webhooks/clerk')
      .set('Content-Type', 'application/json')
      .set(signedHeaders(payload, 'msg_clerk_webhook_metadata'))
      .send(payload);

    expect(response.status).toBe(200);
    expect(prismaMock.user.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ role: 'PATIENT' }),
    });
    expect(JSON.stringify(prismaMock.user.create.mock.calls)).not.toContain('DOCTOR');
    expect(JSON.stringify(prismaMock.user.create.mock.calls)).not.toContain('SUPER_ADMIN');
    expect(JSON.stringify(prismaMock.user.create.mock.calls)).not.toContain('CLINIC_ADMIN');
  });
});
