export type OutlookConfig = {
  clientId: string;
  clientSecret: string;
  tenantId: string;
  redirectUri: string;
};

export class OutlookConfigurationError extends Error {
  constructor(readonly missing: string[]) {
    super(`Faltan variables de Outlook: ${missing.join(', ')}`);
    this.name = 'OutlookConfigurationError';
  }
}

function required(name: keyof NodeJS.ProcessEnv): string | undefined {
  const value = process.env[name]?.trim();
  return value || undefined;
}

export function getOutlookConfig(): OutlookConfig {
  const clientId = required('OUTLOOK_CLIENT_ID');
  const clientSecret = required('OUTLOOK_CLIENT_SECRET');
  const tenantId = required('OUTLOOK_TENANT_ID');
  const redirectUri = required('OUTLOOK_REDIRECT_URI');
  const missing = [!clientId && 'OUTLOOK_CLIENT_ID', !clientSecret && 'OUTLOOK_CLIENT_SECRET', !tenantId && 'OUTLOOK_TENANT_ID', !redirectUri && 'OUTLOOK_REDIRECT_URI'].filter((value): value is string => Boolean(value));
  if (missing.length) throw new OutlookConfigurationError(missing);
  if (!clientId || !clientSecret || !tenantId || !redirectUri) throw new OutlookConfigurationError(['OUTLOOK_CONFIGURATION']);
  return { clientId, clientSecret, tenantId, redirectUri };
}

export function outlookOAuthBaseUrl(config: Pick<OutlookConfig, 'tenantId'>): string {
  return `https://login.microsoftonline.com/${encodeURIComponent(config.tenantId)}/oauth2/v2.0`;
}
