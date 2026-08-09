jest.mock('@clerk/express', () => ({
  clerkMiddleware: jest.fn(() => jest.fn()),
  getAuth: jest.fn(),
}));

import { clerkMiddleware, getAuth } from '@clerk/express';
import { getClerkConfig, validateClerkConfig } from './clerk';
import { clerkSessionMiddleware, resolveClerkSession } from '../services/clerkSession.service';

const clerkMiddlewareMock = jest.mocked(clerkMiddleware);
const getAuthMock = jest.mocked(getAuth);
const original = { ...process.env };

function restoreEnvironment() {
  for (const key of Object.keys(process.env)) if (!(key in original)) delete process.env[key];
  Object.assign(process.env, original);
}

describe('Clerk backend configuration', () => {
  beforeEach(() => { restoreEnvironment(); delete process.env.CLERK_PUBLISHABLE_KEY; delete process.env.CLERK_SECRET_KEY; jest.clearAllMocks(); });
  afterAll(restoreEnvironment);

  it('is disabled when neither backend key is configured', () => {
    expect(getClerkConfig()).toEqual({ status: 'DISABLED' });
    clerkSessionMiddleware();
    expect(clerkMiddlewareMock).not.toHaveBeenCalled();
  });

  it.each([
    [{ CLERK_SECRET_KEY: 'sk_test_placeholder' }, ['CLERK_PUBLISHABLE_KEY']],
    [{ CLERK_PUBLISHABLE_KEY: 'pk_test_placeholder' }, ['CLERK_SECRET_KEY']],
  ] as const)('classifies partial credentials without initializing Clerk', (environment, missing) => {
    expect(getClerkConfig(environment)).toEqual({ status: 'INVALID_PARTIAL_CONFIGURATION', missing });
    expect(() => validateClerkConfig(environment)).toThrow(`missing ${missing[0]}`);
    Object.assign(process.env, environment);
    clerkSessionMiddleware();
    expect(clerkMiddlewareMock).not.toHaveBeenCalled();
  });

  it('initializes the official middleware only with both keys and tolerates no Clerk session', () => {
    process.env.CLERK_PUBLISHABLE_KEY = 'pk_test_placeholder';
    process.env.CLERK_SECRET_KEY = 'sk_test_placeholder';
    const handler = clerkSessionMiddleware();
    expect(clerkMiddlewareMock).toHaveBeenCalledWith({ publishableKey: 'pk_test_placeholder', secretKey: 'sk_test_placeholder' });
    getAuthMock.mockReturnValue({ isAuthenticated: false } as never);
    expect(resolveClerkSession({} as never)).toBeNull();
    expect(handler).toEqual(expect.any(Function));
  });
});
