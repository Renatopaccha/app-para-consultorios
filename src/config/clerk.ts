export type ClerkBackendConfig =
  | { status: 'DISABLED' }
  | { status: 'CONFIGURED'; publishableKey: string; secretKey: string }
  | { status: 'INVALID_PARTIAL_CONFIGURATION'; missing: ReadonlyArray<'CLERK_PUBLISHABLE_KEY' | 'CLERK_SECRET_KEY'> };

const nonEmpty = (value: string | undefined) => value?.trim() || null;

/**
 * Clerk is opt-in during the JWT coexistence phase. A partial configuration is
 * never handed to the SDK, which prevents request-time configuration failures.
 */
export function getClerkConfig(environment: NodeJS.ProcessEnv = process.env): ClerkBackendConfig {
  const publishableKey = nonEmpty(environment.CLERK_PUBLISHABLE_KEY);
  const secretKey = nonEmpty(environment.CLERK_SECRET_KEY);
  if (publishableKey && secretKey) return { status: 'CONFIGURED', publishableKey, secretKey };
  if (!publishableKey && !secretKey) return { status: 'DISABLED' };
  return {
    status: 'INVALID_PARTIAL_CONFIGURATION',
    missing: [
      ...(!publishableKey ? ['CLERK_PUBLISHABLE_KEY' as const] : []),
      ...(!secretKey ? ['CLERK_SECRET_KEY' as const] : []),
    ],
  };
}

/** Fail early in the executable server, without disclosing either key. */
export function validateClerkConfig(environment: NodeJS.ProcessEnv = process.env): ClerkBackendConfig {
  const config = getClerkConfig(environment);
  if (config.status === 'INVALID_PARTIAL_CONFIGURATION') {
    throw new Error(`Clerk backend authentication has partial configuration; missing ${config.missing.join(', ')}.`);
  }
  return config;
}
