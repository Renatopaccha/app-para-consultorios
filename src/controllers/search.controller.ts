import { Request, Response } from 'express';
import prisma from '../prisma';

export const searchDoctorsAndClinics = async (req: Request, res: Response) => {
  try {
    const { lat, lng, specialty, insurance, maxPrice, availableToday, q } = req.query;

    let nearbyClinicIds: string[] | null = null;
    const distancesMap: Record<string, number> = {};

    // 1. Geolocalización (Haversine)
    if (lat && lng) {
      const userLat = parseFloat(String(lat));
      const userLng = parseFloat(String(lng));

      if (!isNaN(userLat) && !isNaN(userLng)) {
        // Query SQL con fórmula Haversine (Radio de 5km)
        // Usamos una subconsulta para filtrar con el alias 'distance' de forma correcta en SQL
        const nearbyClinics = await prisma.$queryRaw<Array<{ id: string, distance: number }>>`
          SELECT * FROM (
            SELECT id, 
              (6371 * acos(cos(radians(${userLat})) * cos(radians(latitude)) * cos(radians(longitude) - radians(${userLng})) + sin(radians(${userLat})) * sin(radians(latitude)))) AS distance
            FROM "ClinicProfile"
            WHERE latitude IS NOT NULL AND longitude IS NOT NULL
          ) AS distances
          WHERE distance <= 5.0
          ORDER BY distance ASC
        `;
        
        nearbyClinicIds = nearbyClinics.map(c => c.id);
        nearbyClinics.forEach(c => {
          distancesMap[c.id] = c.distance;
        });
      }
    }

    // 2. Filtros Avanzados para Doctores
    const whereClause: any = { verificationStatus: 'APPROVED' };

    // Búsqueda por texto libre
    if (q) {
      const searchString = String(q);
      whereClause.user = {
        OR: [
          { firstName: { contains: searchString, mode: 'insensitive' } },
          { lastName: { contains: searchString, mode: 'insensitive' } }
        ]
      };
    }

    // Si hubo geolocalización, filtrar doctores que trabajan en esas clínicas
    if (nearbyClinicIds !== null) {
      if (nearbyClinicIds.length === 0) {
        // Si buscó por geolocalización pero no hay clínicas en el radio, retornamos array vacío
        return res.status(200).json([]);
      }
      whereClause.workplaces = {
        some: {
          clinicProfileId: { in: nearbyClinicIds },
          isActive: true
        }
      };
    }

    // Filtro especialidad
    if (specialty) {
      whereClause.specialties = {
        some: { name: String(specialty) }
      };
    }

    // Filtro seguro médico
    if (insurance) {
      whereClause.insurances = {
        some: { name: String(insurance) }
      };
    }

    // Filtro precio máximo
    if (maxPrice) {
      const parsedPrice = parseFloat(String(maxPrice));
      if (!isNaN(parsedPrice)) {
        whereClause.consultationPrice = { lte: parsedPrice };
      }
    }

    // Filtro disponibilidad hoy
    if (availableToday === 'true') {
      // Ajuste de zona horaria a Ecuador (UTC-5)
      const nowUtc = new Date();
      const ecuadorTime = new Date(nowUtc.getTime() - (5 * 60 * 60 * 1000));
      const currentDay = ecuadorTime.getUTCDay(); // 0 = Domingo, 1 = Lunes...

      if (!whereClause.AND) {
        whereClause.AND = [];
      }
      
      whereClause.AND.push({
        workplaces: {
          some: {
            isActive: true,
            schedules: {
              some: {
                weekday: currentDay
              }
            }
          }
        }
      });
    }

    // 3. Ejecutar Búsqueda en Prisma
    const doctors = await prisma.doctorProfile.findMany({
      where: whereClause,
      select: {
        id: true,
        bio: true,
        profileImageUrl: true,
        consultationPrice: true,
        languages: true,
        user: { select: { id: true, firstName: true, lastName: true } },
        specialties: { select: { id: true, name: true } },
        insurances: { select: { id: true, name: true } },
        services: { select: { id: true, name: true, description: true, price: true, priceCents: true, currency: true, duration: true } },
        workplaces: {
          where: { isActive: true },
          include: { clinicProfile: { select: { id: true, name: true, address: true, logoUrl: true, latitude: true, longitude: true, color: true } } }
        }
      }
    });

    // 4. Formatear y añadir la distancia para el Frontend
    const result = doctors.map(doctor => {
      // Filtrar los workplaces para dejar solo los que están en nearbyClinicIds (si se usó geolocalización)
      let matchedWorkplaces = doctor.workplaces;
      if (nearbyClinicIds !== null) {
        matchedWorkplaces = doctor.workplaces.filter(wp => nearbyClinicIds!.includes(wp.clinicProfileId));
      }

      // Encontrar la clínica más cercana de este doctor basándose en las coincidencias
      let minDistance = Infinity;
      matchedWorkplaces.forEach(wp => {
        const dist = distancesMap[wp.clinicProfileId];
        if (dist !== undefined && dist < minDistance) {
          minDistance = dist;
        }
      });

      return {
        ...doctor,
        workplaces: matchedWorkplaces,
        closestDistance: minDistance !== Infinity ? minDistance : null
      };
    });

    // Ordenar por distancia si se usó geolocalización
    if (nearbyClinicIds !== null) {
      result.sort((a, b) => {
        if (a.closestDistance === null) return 1;
        if (b.closestDistance === null) return -1;
        return (a.closestDistance as number) - (b.closestDistance as number);
      });
    }

    return res.status(200).json(result);
  } catch (error) {
    console.error('[SearchController] Error en searchDoctorsAndClinics:', error);
    return res.status(500).json({ error: 'Error interno al buscar médicos y clínicas' });
  }
};
