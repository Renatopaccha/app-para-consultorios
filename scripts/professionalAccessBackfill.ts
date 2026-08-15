import 'dotenv/config';
import prisma, { disconnectPrisma } from '../src/prisma';
import {
  applyLegacyProfessionalAccessBackfill,
  planLegacyProfessionalAccessBackfill,
  ProfessionalAccessBackfillConflictError,
} from '../src/services/professionalAccessBackfill.service';

const APPLY_CONFIRMATION = 'APPLY_LEGACY_PROFESSIONAL_ACCESS_BACKFILL';

function assertApplyWasExplicitlyConfirmed(): void {
  const confirmation = process.argv.find((value) => value.startsWith('--confirm='))?.slice('--confirm='.length);
  if (confirmation !== APPLY_CONFIRMATION) {
    throw new Error(
      `APPLY requiere --confirm=${APPLY_CONFIRMATION}. PLAN es el modo seguro predeterminado.`,
    );
  }
  if (
    process.env.NODE_ENV === 'production'
    && process.env.PROFESSIONAL_ACCESS_BACKFILL_ALLOW_PRODUCTION !== 'true'
  ) {
    throw new Error(
      'APPLY en production está bloqueado salvo PROFESSIONAL_ACCESS_BACKFILL_ALLOW_PRODUCTION=true.',
    );
  }
}

async function main(): Promise<void> {
  const mode = (process.argv[2] ?? 'plan').toLowerCase();
  if (!['plan', 'apply'].includes(mode)) {
    throw new Error('Modo inválido. Usa plan (predeterminado/read-only) o apply.');
  }

  if (mode === 'plan') {
    const plan = await planLegacyProfessionalAccessBackfill(prisma);
    console.log(JSON.stringify(plan, null, 2));
    return;
  }

  assertApplyWasExplicitlyConfirmed();
  const result = await applyLegacyProfessionalAccessBackfill(prisma);
  console.log(JSON.stringify({ ...result, mode: 'APPLY' }, null, 2));
}

main()
  .catch((error: unknown) => {
    if (error instanceof ProfessionalAccessBackfillConflictError) {
      console.error(JSON.stringify(error.plan, null, 2));
    }
    console.error(error instanceof Error ? error.message : 'Error desconocido durante el backfill.');
    process.exitCode = 1;
  })
  .finally(disconnectPrisma);
