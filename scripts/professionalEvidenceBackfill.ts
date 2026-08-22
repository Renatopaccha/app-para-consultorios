import 'dotenv/config';
import prisma, { disconnectPrisma } from '../src/prisma';
import {
  formatProfessionalEvidenceBackfillPlan,
  planProfessionalEvidenceBackfill,
} from '../src/services/professionalEvidenceBackfillPlan.service';

function parseArguments(): { json: boolean } {
  const args = process.argv.slice(2);
  const mode = args.find((argument) => !argument.startsWith('--')) ?? 'plan';
  const unsupported = args.filter((argument) => argument !== 'plan' && argument !== '--json');
  if (mode !== 'plan' || unsupported.length) {
    throw new Error('Modo inválido. Solo existe plan (read-only); APPLY no está soportado.');
  }
  return { json: args.includes('--json') };
}

async function main(): Promise<void> {
  const { json } = parseArguments();
  const plan = await planProfessionalEvidenceBackfill(prisma);
  console.log(json ? JSON.stringify(plan) : formatProfessionalEvidenceBackfillPlan(plan));
}

main()
  .catch(() => {
    // Deliberately generic: errors must never echo snapshot payloads, identifiers,
    // storage locators, checksums or applicant data into operational logs.
    console.error('PROFESSIONAL_EVIDENCE_BACKFILL_PLAN_FAILED');
    process.exitCode = 1;
  })
  .finally(disconnectPrisma);
