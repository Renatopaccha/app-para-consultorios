import dotenv from 'dotenv';

dotenv.config();

import prisma from '../src/prisma';
import {
  assertLocalDevelopmentExecution,
  updateExistingDevelopmentDoctorEmail,
} from '../src/services/developmentDoctorEmail.service';

async function main() {
  assertLocalDevelopmentExecution(process.env);
  const result = await updateExistingDevelopmentDoctorEmail(prisma, process.env.DEV_DOCTOR_EMAIL);

  // Intentionally safe operational output: no hashes, tokens, keys, or medical data.
  console.log('Doctor de desarrollo actualizado de forma segura:', result);
}

main()
  .catch((error) => {
    console.error(error instanceof Error ? error.message : 'No se pudo actualizar el correo del doctor de desarrollo.');
    process.exitCode = 1;
  })
  .finally(async () => prisma.$disconnect());
