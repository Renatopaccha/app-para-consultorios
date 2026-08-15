import { getTestDatabaseUrl } from '../config/testDatabase';

export const APPLY_CONFIRMATION = 'APPLY_PROFESSIONAL_CATALOG';

export interface CatalogDatabaseTarget {
  url: string;
  environment: 'test' | 'development' | 'read-only';
  databaseName: string;
}

function parseDatabaseName(url: string): string {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error('La URL de base de datos no es válida.');
  }
  if (!['postgres:', 'postgresql:'].includes(parsed.protocol)) throw new Error('El importador solo admite PostgreSQL.');
  const databaseName = decodeURIComponent(parsed.pathname.replace(/^\//, ''));
  if (!databaseName) throw new Error('La URL no incluye un nombre de base de datos.');
  return databaseName;
}

export function resolveCatalogDatabaseTarget(env: NodeJS.ProcessEnv, applying: boolean): CatalogDatabaseTarget {
  const nodeEnv = env.NODE_ENV;
  if (applying && !['test', 'development'].includes(nodeEnv ?? '')) {
    throw new Error('APPLY bloqueado: NODE_ENV debe ser test o development.');
  }
  if (applying && nodeEnv === 'production') throw new Error('APPLY bloqueado en producción.');

  const url = nodeEnv === 'test' ? getTestDatabaseUrl() : env.DATABASE_URL;
  if (!url) throw new Error(nodeEnv === 'test' ? 'TEST_DATABASE_URL es obligatoria.' : 'DATABASE_URL es obligatoria.');
  const databaseName = parseDatabaseName(url);

  if (applying) {
    if (env.CATALOG_APPLY_CONFIRM !== APPLY_CONFIRMATION) {
      throw new Error(`APPLY bloqueado: CATALOG_APPLY_CONFIRM debe ser ${APPLY_CONFIRMATION}.`);
    }
    if (!env.CATALOG_TARGET_DATABASE || env.CATALOG_TARGET_DATABASE !== databaseName) {
      throw new Error('APPLY bloqueado: CATALOG_TARGET_DATABASE debe coincidir exactamente con la base destino.');
    }
  }

  return {
    url,
    environment: nodeEnv === 'test' ? 'test' : nodeEnv === 'development' ? 'development' : 'read-only',
    databaseName,
  };
}
