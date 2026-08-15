import { cpSync, mkdtempSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import path from 'path';
import { normalizeCatalogName } from './catalogNameNormalization';
import { loadProfessionalCatalogs } from './professionalCatalog.loader';
import { APPLY_CONFIRMATION, resolveCatalogDatabaseTarget } from './professionalCatalog.safety';

describe('catálogos profesionales', () => {
  it('normaliza Unicode, tildes, casing y espacios de forma central', () => {
    expect(normalizeCatalogName('  PSICOLOGÍA\u00a0  CLÍNICA  ')).toBe('psicologia clinica');
    expect(normalizeCatalogName('Espan\u0303ol')).toBe('espanol');
  });

  it('carga únicamente archivos cuyo SHA-256 coincide con el manifiesto', () => {
    expect(loadProfessionalCatalogs().professions.records).toHaveLength(3);
    const temporaryDirectory = mkdtempSync(path.join(tmpdir(), 'zenda-catalog-checksum-'));
    try {
      cpSync(path.resolve(process.cwd(), 'catalogs'), temporaryDirectory, { recursive: true });
      writeFileSync(path.join(temporaryDirectory, 'languages.v1.json'), '{}\n');
      expect(() => loadProfessionalCatalogs(temporaryDirectory)).toThrow('checksum SHA-256 no coincide');
    } finally {
      rmSync(temporaryDirectory, { recursive: true });
    }
  });

  it('bloquea APPLY fuera de test/development y exige doble confirmación del destino', () => {
    expect(() => resolveCatalogDatabaseTarget({
      NODE_ENV: 'production', DATABASE_URL: 'postgresql://localhost/zenda_prod',
    }, true)).toThrow('NODE_ENV debe ser test o development');

    expect(() => resolveCatalogDatabaseTarget({
      NODE_ENV: 'development', DATABASE_URL: 'postgresql://localhost/vitali_db',
      CATALOG_APPLY_CONFIRM: APPLY_CONFIRMATION, CATALOG_TARGET_DATABASE: 'otra_base',
    }, true)).toThrow('CATALOG_TARGET_DATABASE debe coincidir');
  });
});
