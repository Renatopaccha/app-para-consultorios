import { Pool } from 'pg';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../generated/prisma';
import { getRuntimeDatabaseUrl } from './config/testDatabase';

const connectionString = getRuntimeDatabaseUrl();

const pool = new Pool({ connectionString });
const adapter = new PrismaPg(pool);

const prisma = new PrismaClient({ adapter });

export default prisma;

export async function disconnectPrisma(): Promise<void> {
  await prisma.$disconnect();
  await pool.end();
}
