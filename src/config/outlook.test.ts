import type { Request, Response } from 'express';

const prismaMock = {
  doctorProfile: { findUnique: jest.fn(), update: jest.fn() },
  clinicProfile: { findUnique: jest.fn(), update: jest.fn() },
};
jest.mock('../prisma', () => ({ __esModule: true, default: prismaMock }));

import { getOutlookConfig, OutlookConfigurationError } from './outlook';
import { getOutlookAuthUrl, outlookCallback } from '../controllers/calendar.controller';

const ENV_KEYS = ['OUTLOOK_CLIENT_ID', 'OUTLOOK_CLIENT_SECRET', 'OUTLOOK_TENANT_ID', 'OUTLOOK_REDIRECT_URI', 'AZURE_CLIENT_ID'] as const;
const original = Object.fromEntries(ENV_KEYS.map((key) => [key, process.env[key]])) as Record<typeof ENV_KEYS[number], string | undefined>;

function configure(): void {
  process.env.OUTLOOK_CLIENT_ID = 'outlook-client-id';
  process.env.OUTLOOK_CLIENT_SECRET = 'outlook-client-secret';
  process.env.OUTLOOK_TENANT_ID = 'tenant-zenda';
  process.env.OUTLOOK_REDIRECT_URI = 'http://localhost:3000/api/calendar/outlook/callback';
  process.env.AZURE_CLIENT_ID = 'legacy-must-not-be-used';
}

function restore(): void {
  for (const key of ENV_KEYS) {
    if (original[key] === undefined) delete process.env[key]; else process.env[key] = original[key];
  }
}

function responseMock() {
  const result: { statusCode?: number; body?: unknown } = {};
  type ResponseStub = { status: jest.Mock<ResponseStub, [number]>; json: jest.Mock<ResponseStub, [unknown]> };
  let response: ResponseStub;
  response = { status: jest.fn((status: number) => { result.statusCode = status; return response; }), json: jest.fn((body: unknown) => { result.body = body; return response; }) };
  return { response: response as unknown as Response, result };
}

function stateFor(role: 'DOCTOR' | 'CLINIC_ADMIN' = 'DOCTOR', userId = 'user-1'): string {
  const { response, result } = responseMock();
  getOutlookAuthUrl({ user: { id: userId, role } } as unknown as Request, response);
  return new URL((result.body as { url: string }).url).searchParams.get('state')!;
}

function callback(state: string, code = 'authorization-code') {
  const { response, result } = responseMock();
  return { result, run: () => outlookCallback({ query: { code, state } } as unknown as Request, response) };
}

function tokenResponse(status = 200, body: unknown = { access_token: 'access-token', refresh_token: 'refresh-token', expires_in: 3600 }) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

describe('configuración y callback Outlook Calendar', () => {
  beforeEach(() => {
    configure();
    jest.clearAllMocks();
    prismaMock.doctorProfile.findUnique.mockResolvedValue({ id: 'doctor-profile' });
    prismaMock.doctorProfile.update.mockResolvedValue({});
    prismaMock.clinicProfile.findUnique.mockResolvedValue({ id: 'clinic-profile' });
    prismaMock.clinicProfile.update.mockResolvedValue({});
  });
  afterAll(restore);

  it('usa exclusivamente las cuatro variables OUTLOOK canónicas', () => {
    expect(getOutlookConfig()).toEqual({ clientId: 'outlook-client-id', clientSecret: 'outlook-client-secret', tenantId: 'tenant-zenda', redirectUri: 'http://localhost:3000/api/calendar/outlook/callback' });
  });

  it.each(['OUTLOOK_CLIENT_ID', 'OUTLOOK_CLIENT_SECRET', 'OUTLOOK_TENANT_ID', 'OUTLOOK_REDIRECT_URI'] as const)('rechaza configuración incompleta: %s', (key) => {
    delete process.env[key];
    expect(() => getOutlookConfig()).toThrow(OutlookConfigurationError);
  });

  it('construye una URL con state firmado, tenant y redirect canónicos', () => {
    const { response, result } = responseMock();
    getOutlookAuthUrl({ user: { id: 'user-1', role: 'DOCTOR' } } as unknown as Request, response);
    const url = new URL((result.body as { url: string }).url);
    expect(url.origin + url.pathname).toBe('https://login.microsoftonline.com/tenant-zenda/oauth2/v2.0/authorize');
    expect(url.searchParams.get('client_id')).toBe('outlook-client-id');
    expect(url.searchParams.get('redirect_uri')).toBe(process.env.OUTLOOK_REDIRECT_URI);
    expect(url.searchParams.get('client_id')).not.toBe(process.env.AZURE_CLIENT_ID);
    expect(url.searchParams.get('state')).toContain('.');
    expect(url.searchParams.get('state')).not.toContain('user-1');
  });

  it('persiste tokens para DOCTOR y conserva refresh token si Microsoft no devuelve uno', async () => {
    const fetchMock = jest.spyOn(global, 'fetch').mockResolvedValue(tokenResponse(200, { access_token: 'access-token', expires_in: 3600 }));
    const { result, run } = callback(stateFor('DOCTOR'));
    await run();
    expect(result.statusCode).toBe(200);
    expect(prismaMock.doctorProfile.update).toHaveBeenCalledWith(expect.objectContaining({ where: { id: 'doctor-profile' }, data: expect.objectContaining({ outlookAccessToken: 'access-token' }) }));
    expect(prismaMock.doctorProfile.update.mock.calls[0][0].data).not.toHaveProperty('outlookRefreshToken');
    const [, request] = fetchMock.mock.calls[0] ?? [];
    const body = new URLSearchParams(String(request?.body));
    expect(body.get('client_secret')).toBe('outlook-client-secret');
    fetchMock.mockRestore();
  });

  it('persiste tokens para CLINIC_ADMIN', async () => {
    const fetchMock = jest.spyOn(global, 'fetch').mockResolvedValue(tokenResponse());
    const { result, run } = callback(stateFor('CLINIC_ADMIN'));
    await run();
    expect(result.statusCode).toBe(200);
    expect(prismaMock.clinicProfile.update).toHaveBeenCalledWith(expect.objectContaining({ where: { id: 'clinic-profile' }, data: expect.objectContaining({ outlookRefreshToken: 'refresh-token' }) }));
    fetchMock.mockRestore();
  });

  it.each([
    [400, 'OUTLOOK_TOKEN_REJECTED', 400],
    [401, 'OUTLOOK_TOKEN_PROVIDER_AUTH_FAILED', 502],
    [429, 'OUTLOOK_TOKEN_RATE_LIMITED', 503],
    [500, 'OUTLOOK_TOKEN_PROVIDER_UNAVAILABLE', 502],
  ])('maps Microsoft token HTTP %i without exposing upstream data', async (upstreamStatus, error, expectedStatus) => {
    const log = jest.spyOn(console, 'error').mockImplementation(() => undefined);
    const fetchMock = jest.spyOn(global, 'fetch').mockResolvedValue(tokenResponse(upstreamStatus, { error_description: 'sensitive upstream detail' }));
    const { result, run } = callback(stateFor());
    await run();
    expect(result).toEqual({ statusCode: expectedStatus, body: expect.objectContaining({ error }) });
    expect(JSON.stringify(result.body)).not.toContain('sensitive upstream detail');
    fetchMock.mockRestore(); log.mockRestore();
  });

  it('maps network and malformed JSON responses safely', async () => {
    const log = jest.spyOn(console, 'error').mockImplementation(() => undefined);
    const fetchMock = jest.spyOn(global, 'fetch').mockRejectedValueOnce(new TypeError('network failure')).mockResolvedValueOnce(new Response('not-json', { status: 200 }));
    const first = callback(stateFor()); await first.run();
    expect(first.result).toEqual({ statusCode: 503, body: expect.objectContaining({ error: 'OUTLOOK_TOKEN_NETWORK_ERROR' }) });
    const second = callback(stateFor()); await second.run();
    expect(second.result).toEqual({ statusCode: 502, body: expect.objectContaining({ error: 'OUTLOOK_TOKEN_RESPONSE_INVALID' }) });
    fetchMock.mockRestore(); log.mockRestore();
  });

  it('rejects an invalid or tampered state before exchanging a code', async () => {
    const fetchMock = jest.spyOn(global, 'fetch');
    const valid = stateFor();
    const tampered = `${valid.slice(0, -1)}x`;
    const { result, run } = callback(tampered);
    await run();
    expect(result).toEqual({ statusCode: 400, body: expect.objectContaining({ error: 'OUTLOOK_STATE_INVALID' }) });
    expect(fetchMock).not.toHaveBeenCalled();
    fetchMock.mockRestore();
  });

  it('returns 404 when the signed owner profile no longer exists', async () => {
    prismaMock.doctorProfile.findUnique.mockResolvedValue(null);
    const fetchMock = jest.spyOn(global, 'fetch').mockResolvedValue(tokenResponse());
    const { result, run } = callback(stateFor());
    await run();
    expect(result.statusCode).toBe(404);
    fetchMock.mockRestore();
  });

  it('keeps database failures internal and returns a generic 500', async () => {
    const log = jest.spyOn(console, 'error').mockImplementation(() => undefined);
    prismaMock.doctorProfile.update.mockRejectedValue(new Error('database connection detail'));
    const fetchMock = jest.spyOn(global, 'fetch').mockResolvedValue(tokenResponse());
    const { result, run } = callback(stateFor());
    await run();
    expect(result).toEqual({ statusCode: 500, body: { error: 'Error al procesar la respuesta de Microsoft' } });
    expect(JSON.stringify(result.body)).not.toContain('database connection detail');
    fetchMock.mockRestore(); log.mockRestore();
  });

  it('does not reflect Microsoft authorization errors to the client', async () => {
    const { response, result } = responseMock();
    await outlookCallback({ query: { error: 'access_denied_with_internal_detail' } } as unknown as Request, response);
    expect(result).toEqual({ statusCode: 400, body: { error: 'OUTLOOK_AUTHORIZATION_DENIED', message: 'Microsoft no completó la autorización.' } });
  });

  it('does not log or return authorization codes, tokens, refresh tokens, secrets, or state', async () => {
    const log = jest.spyOn(console, 'error').mockImplementation(() => undefined);
    const code = 'authorization-code-should-not-appear';
    const state = stateFor();
    const fetchMock = jest.spyOn(global, 'fetch').mockResolvedValue(tokenResponse());
    const { result, run } = callback(state, code);
    await run();
    const output = `${JSON.stringify(result.body)} ${log.mock.calls.flat().join(' ')}`;
    for (const secret of [code, state, 'access-token', 'refresh-token', 'outlook-client-secret']) expect(output).not.toContain(secret);
    fetchMock.mockRestore(); log.mockRestore();
  });
});
