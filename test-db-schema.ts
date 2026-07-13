import * as dotenv from 'dotenv';
dotenv.config();
import { Client } from 'pg';

async function main() {
  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  const res = await client.query(`
    SELECT column_name 
    FROM information_schema.columns 
    WHERE table_name='ClinicProfile' AND column_name='color';
  `);
  console.log("Column 'color' exists in ClinicProfile:", res.rows.length > 0);
  
  const res2 = await client.query(`
    SELECT column_name 
    FROM information_schema.columns 
    WHERE table_name='Appointment' AND column_name='paymentStatus';
  `);
  console.log("Column 'paymentStatus' exists in Appointment:", res2.rows.length > 0);
  await client.end();
}

main().catch(console.error);
