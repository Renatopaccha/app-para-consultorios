import dotenv from 'dotenv';

const environmentFile = process.env.NODE_ENV === 'test' ? '.env.test' : '.env';
dotenv.config({ path: environmentFile });

async function main(): Promise<void> {
  const requestedMode = process.argv[2] ?? 'plan';
  if (!['plan', 'apply'].includes(requestedMode)) throw new Error('Uso: professionalCatalog.ts [plan|apply]');
  const applying = requestedMode === 'apply';
  const { resolveCatalogDatabaseTarget } = await import('../src/catalogs/professionalCatalog.safety');
  const target = resolveCatalogDatabaseTarget(process.env, applying);
  const { default: prisma, disconnectPrisma } = await import('../src/prisma');
  const { applyProfessionalCatalogImport, planProfessionalCatalogImport, ProfessionalCatalogConflictError } = await import('../src/catalogs/professionalCatalog.service');

  try {
    const context = { environment: target.environment, databaseName: target.databaseName };
    const report = applying
      ? await applyProfessionalCatalogImport(prisma, context)
      : await planProfessionalCatalogImport(prisma, context);
    console.log(JSON.stringify(report, null, 2));
    if (!report.prerequisites.ready || report.conflicts.length) process.exitCode = 2;
  } catch (error) {
    if (error instanceof ProfessionalCatalogConflictError) {
      console.error(JSON.stringify(error.plan, null, 2));
      process.exitCode = 2;
      return;
    }
    throw error;
  } finally {
    await disconnectPrisma();
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : 'Error desconocido en el importador de catálogos.');
  process.exitCode = 1;
});
