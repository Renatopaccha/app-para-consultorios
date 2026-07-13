import * as dotenv from 'dotenv';
dotenv.config();
import { Request, Response } from 'express';
import { getMyAppointments } from './src/controllers/doctor.controller';
import { getMetrics } from './src/controllers/dashboard.controller';

async function run() {
  console.log("--- Testing getMyAppointments ---");
  const req1 = {
    user: { id: "dummy-user", role: "DOCTOR" },
    query: { startDate: "2026-07-01", endDate: "2026-07-31" }
  } as unknown as Request;
  
  const res1 = {
    status: (code: number) => ({
      json: (data: any) => console.log(`Response ${code}:`, data)
    }),
    json: (data: any) => console.log(`Response 200:`, data)
  } as unknown as Response;

  try {
    await getMyAppointments(req1, res1);
  } catch (e) {
    console.error("Uncaught Error in getMyAppointments:", e);
  }

  console.log("\n--- Testing getMetrics ---");
  const req2 = {
    user: { id: "dummy-user", role: "DOCTOR" },
    query: { type: "weekly", date: new Date().toISOString() }
  } as unknown as Request;

  try {
    await getMetrics(req2, res1);
  } catch (e) {
    console.error("Uncaught Error in getMetrics:", e);
  }
}

run();
