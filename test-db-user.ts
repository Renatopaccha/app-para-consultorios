import * as dotenv from 'dotenv';
dotenv.config();
import prisma from './src/prisma';

async function main() {
  try {
    const user = await prisma.user.findFirst();
    console.log("Success! user =", user);
  } catch (error: any) {
    console.error("Error:", error.message);
  }
}

main().finally(() => prisma.$disconnect());
