import dotenv from 'dotenv';
import { defineConfig } from 'prisma/config';
import { getTestDatabaseUrl } from '../src/config/testDatabase';

// Test migrations deliberately load the isolated test file, never .env.
dotenv.config({ path: '.env.test' });

export default defineConfig({
  schema: 'schema.prisma',
  migrations: {
    path: 'migrations',
  },
  datasource: {
    // Intentionally never falls back to DATABASE_URL.
    url: getTestDatabaseUrl(),
  },
});
