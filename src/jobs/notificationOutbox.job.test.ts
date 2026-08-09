jest.mock('../services/notificationOutboxWorker.service', () => ({ processNotificationOutboxBatch: jest.fn() }));

import { notificationWorkerEnabled, sanitizedWorkerError } from './notificationOutbox.job';

describe('notification outbox worker infrastructure handling', () => {
  it('reports a safe Prisma code and a migration hint without exposing the database error', () => {
    const error = Object.assign(new Error('postgresql://secret:password@localhost/private'), { name: 'PrismaClientKnownRequestError', code: 'P2021' });
    expect(sanitizedWorkerError(error)).toEqual({ error: 'PrismaClientKnownRequestError', code: 'P2021', hint: 'DATABASE_MIGRATIONS_REQUIRED' });
    expect(JSON.stringify(sanitizedWorkerError(error))).not.toContain('password');
  });

  it('allows an explicit documented opt-out without changing the default', () => {
    expect(notificationWorkerEnabled(undefined)).toBe(true);
    expect(notificationWorkerEnabled('true')).toBe(true);
    expect(notificationWorkerEnabled('false')).toBe(false);
    expect(notificationWorkerEnabled('0')).toBe(false);
  });
});
