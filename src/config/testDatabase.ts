const SAFE_TEST_HOSTS = new Set(['localhost', '127.0.0.1', '::1', 'postgres-test']);

/**
 * Returns the only connection string that tests may use. This deliberately
 * never reads DATABASE_URL, so a test cannot fall back to development data.
 */
export function getTestDatabaseUrl(): string {
  const value = process.env.TEST_DATABASE_URL;

  if (!value) {
    throw new Error('TEST_DATABASE_URL es obligatoria para ejecutar pruebas de integración.');
  }

  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error('TEST_DATABASE_URL debe ser una URL PostgreSQL válida.');
  }

  if (!['postgres:', 'postgresql:'].includes(url.protocol)) {
    throw new Error('TEST_DATABASE_URL debe usar el protocolo PostgreSQL.');
  }

  const databaseName = url.pathname.replace(/^\//, '').toLowerCase();
  if (!SAFE_TEST_HOSTS.has(url.hostname) || !/(^|[_-])test($|[_-])|_test$/.test(databaseName)) {
    throw new Error(
      'TEST_DATABASE_URL fue rechazada: debe apuntar a un host local de pruebas y a una base cuyo nombre incluya "test".'
    );
  }

  return value;
}

export function assertTestExecutionEnvironment(): void {
  if (process.env.NODE_ENV !== 'test') {
    throw new Error('Las pruebas de integración deben ejecutarse con NODE_ENV=test.');
  }
}

export function getRuntimeDatabaseUrl(): string {
  if (process.env.NODE_ENV === 'test') {
    return getTestDatabaseUrl();
  }

  if (!process.env.DATABASE_URL) {
    throw new Error('DATABASE_URL es obligatoria fuera del entorno de pruebas.');
  }

  return process.env.DATABASE_URL;
}
