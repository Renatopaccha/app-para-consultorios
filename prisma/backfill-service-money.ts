import dotenv from 'dotenv';
dotenv.config({ path: '.env.test' });

import prisma, { disconnectPrisma } from '../src/prisma';
import { getTestDatabaseUrl } from '../src/config/testDatabase';
import { dollarsToCents } from '../src/utils/money';

async function main() {
  getTestDatabaseUrl();
  const services = await prisma.service.findMany({ where: { priceCents: null } });
  let converted = 0;
  const invalid: string[] = [];
  for (const service of services) {
    try {
      const priceCents = dollarsToCents(service.price);
      await prisma.service.update({ where: { id: service.id }, data: { priceCents, currency: 'USD' } });
      converted++;
    } catch {
      invalid.push(service.id);
    }
  }
  console.log(JSON.stringify({ converted, invalidServiceIds: invalid }));
  if (invalid.length) process.exitCode = 1;
}

main().finally(() => disconnectPrisma());
