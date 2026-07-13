import { Request, Response } from 'express';
import prisma from './prisma';

export const testGetMyAppointments = async () => {
  try {
    const userId = "dummydummy"; // Assume any string
    const doctor = await prisma.doctorProfile.findUnique({
      where: { userId }
    });
    console.log(doctor);
  } catch(e) {
    console.error(e);
  }
}
testGetMyAppointments();
