import type { Request, Response } from 'express';
jest.mock('../prisma', () => ({ __esModule: true, default: {} }));
import { getOutlookConfig, OutlookConfigurationError } from './outlook';
import { getOutlookAuthUrl, outlookCallback } from '../controllers/calendar.controller';

const ENV_KEYS = ['OUTLOOK_CLIENT_ID', 'OUTLOOK_CLIENT_SECRET', 'OUTLOOK_TENANT_ID', 'OUTLOOK_REDIRECT_URI', 'AZURE_CLIENT_ID'] as const;
const original = Object.fromEntries(ENV_KEYS.map(key => [key, process.env[key]])) as Record<typeof ENV_KEYS[number], string | undefined>;
function configure(): void {
  process.env.OUTLOOK_CLIENT_ID = 'outlook-client-id';
  process.env.OUTLOOK_CLIENT_SECRET = 'outlook-client-secret';
  process.env.OUTLOOK_TENANT_ID = 'tenant-zenda';
  process.env.OUTLOOK_REDIRECT_URI = 'http://localhost:3000/api/calendar/outlook/callback';
  process.env.AZURE_CLIENT_ID = 'legacy-must-not-be-used';
}
function restore(): void { for (const key of ENV_KEYS) { if (original[key] === undefined) delete process.env[key]; else process.env[key] = original[key]; } }
function responseMock() {
  const result: { statusCode?: number; body?: unknown } = {};
  type ResponseStub = { status: jest.Mock<ResponseStub, [number]>; json: jest.Mock<ResponseStub, [unknown]> };
  let response: ResponseStub;
  response = { status: jest.fn((status: number) => { result.statusCode = status; return response; }), json: jest.fn((body: unknown) => { result.body = body; return response; }) };
  return { response: response as unknown as Response, result };
}

describe('configuración Outlook Calendar', () => {
  beforeEach(configure);
  afterAll(restore);

  it('usa exclusivamente las cuatro variables OUTLOOK canónicas', () => {
    expect(getOutlookConfig()).toEqual({ clientId: 'outlook-client-id', clientSecret: 'outlook-client-secret', tenantId: 'tenant-zenda', redirectUri: 'http://localhost:3000/api/calendar/outlook/callback' });
  });

  it.each(['OUTLOOK_CLIENT_ID', 'OUTLOOK_CLIENT_SECRET', 'OUTLOOK_TENANT_ID', 'OUTLOOK_REDIRECT_URI'] as const)('rechaza configuración incompleta: %s', key => {
    delete process.env[key];
    expect(() => getOutlookConfig()).toThrow(OutlookConfigurationError);
    configure();
  });

  it('no usa AZURE_CLIENT_ID y construye autorización con tenant y redirect canónicos', () => {
    const { response, result } = responseMock();
    getOutlookAuthUrl({ user: { id: 'user-1', role: 'DOCTOR' } } as unknown as Request, response);
    expect(result.statusCode).toBe(200);
    const url = new URL((result.body as { url: string }).url);
    expect(url.origin + url.pathname).toBe('https://login.microsoftonline.com/tenant-zenda/oauth2/v2.0/authorize');
    expect(url.searchParams.get('client_id')).toBe('outlook-client-id');
    expect(url.searchParams.get('redirect_uri')).toBe(process.env.OUTLOOK_REDIRECT_URI);
    expect(url.searchParams.get('client_id')).not.toBe(process.env.AZURE_CLIENT_ID);
  });

  it('callback usa tenant, client id, secreto y la misma redirect URI sin exponerlos', async () => {
    const fetchMock = jest.spyOn(global, 'fetch').mockResolvedValue(new Response(JSON.stringify({ access_token: 'access-token', refresh_token: 'refresh-token', expires_in: 3600 }), { status: 200 }));
    const { response, result } = responseMock();
    const state = Buffer.from(JSON.stringify({ userId: 'user-1', role: 'PATIENT' })).toString('base64');
    await outlookCallback({ query: { code: 'code-1', state } } as unknown as Request, response);
    expect(result.statusCode).toBe(403);
    const [url, request] = fetchMock.mock.calls[0] ?? [];
    expect(url).toBe('https://login.microsoftonline.com/tenant-zenda/oauth2/v2.0/token');
    const body = new URLSearchParams(String(request?.body));
    expect(body.get('client_id')).toBe('outlook-client-id');
    expect(body.get('client_secret')).toBe('outlook-client-secret');
    expect(body.get('redirect_uri')).toBe(process.env.OUTLOOK_REDIRECT_URI);
    expect(JSON.stringify(result.body)).not.toContain('outlook-client-secret');
    fetchMock.mockRestore();
  });

  it('Outlook opcional devuelve 503 controlado sin impedir otros flujos', () => {
    delete process.env.OUTLOOK_CLIENT_SECRET;
    const log = jest.spyOn(console, 'error').mockImplementation(() => undefined);
    const { response, result } = responseMock();
    getOutlookAuthUrl({ user: { id: 'user-1', role: 'DOCTOR' } } as unknown as Request, response);
    expect(result).toEqual({ statusCode: 503, body: { error: 'OUTLOOK_NOT_CONFIGURED', message: 'La sincronización de Outlook no está configurada actualmente.' } });
    expect(log.mock.calls.flat().join(' ')).not.toContain('outlook-client-secret');
    log.mockRestore(); configure();
  });
});
