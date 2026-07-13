import * as dotenv from 'dotenv';
dotenv.config();
import prisma from './src/prisma';

async function main() {
  try {
    const doctor = await prisma.doctorProfile.findUnique({ where: { userId: "dummy-user-id" } });
    console.log("Success! doctor =", doctor);
  } catch (error) {
    console.error("Error connecting to DB or running query:", error);
  }
}

main().finally(() => prisma.$disconnect());
