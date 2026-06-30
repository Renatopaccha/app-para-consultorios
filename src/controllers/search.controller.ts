import { Request, Response } from 'express';
import prisma from '../prisma';

export const searchDoctors = async (req: Request, res: Response) => {
  try {
    const { q, specialty, insurance } = req.query;

    const whereClause: any = {};

    // 1. Filtrar por nombre o apellido (case-insensitive)
    if (q) {
      const searchString = String(q);
      whereClause.user = {
        OR: [
          { firstName: { contains: searchString, mode: 'insensitive' } },
          { lastName: { contains: searchString, mode: 'insensitive' } }
        ]
      };
    }

    // 2. Filtrar por especialidad
    if (specialty) {
      whereClause.specialties = {
        some: {
          name: String(specialty)
        }
      };
    }

    // 3. Filtrar por seguro
    if (insurance) {
      whereClause.insurances = {
        some: {
          name: String(insurance)
        }
      };
    }

    // Ejecutar la búsqueda con Prisma
    const doctors = await prisma.doctorProfile.findMany({
      where: whereClause,
      include: {
        user: {
          select: {
            firstName: true,
            lastName: true,
            email: true,
            // (Si en el futuro añades photo en el schema, agrégalo aquí)
          }
        },
        specialties: true,
        insurances: true,
        workplaces: {
          where: { isActive: true },
          include: {
            clinicProfile: true
          }
        }
      }
    });

    res.status(200).json(doctors);
  } catch (error) {
    console.error('[SearchController] Error en searchDoctors:', error);
    res.status(500).json({ error: 'Error interno al buscar doctores' });
  }
};
