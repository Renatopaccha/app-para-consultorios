import { Request, Response } from 'express';
import { AuthRequest } from '../middlewares/auth.middleware';
import prisma from '../prisma';

export const getDoctors = async (req: Request, res: Response) => {
  try {
    const page = parseInt(req.query.page as string) || 1;
    const limit = parseInt(req.query.limit as string) || 10;
    const skip = (page - 1) * limit;

    const doctors = await prisma.doctorProfile.findMany({
      skip,
      take: limit,
      include: {
        user: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
            email: true,
            phone: true
          }
        },
        workplaces: {
          where: { isActive: true },
          include: {
            clinicProfile: {
              select: {
                id: true,
                name: true,
                address: true
              }
            }
          }
        },
        specialties: true
      }
    });
    res.json(doctors);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Error al obtener doctores' });
  }
};

export const getDoctorById = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const doctor = await prisma.doctorProfile.findUnique({ 
      where: { id: id as string },
      include: {
        user: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
            email: true,
            phone: true
          }
        },
        workplaces: {
          where: { isActive: true },
          include: {
            clinicProfile: {
              select: {
                id: true,
                name: true,
                address: true
              }
            }
          }
        },
        specialties: true
      }
    });
    if (!doctor) {
      return res.status(404).json({ error: 'Doctor no encontrado' });
    }
    res.json(doctor);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Error al obtener doctor' });
  }
};

export const createDoctor = async (req: Request, res: Response) => {
  try {
    const { licenseNumber, consultationPrice, userId } = req.body;
    if (!licenseNumber || consultationPrice === undefined || !userId) {
      return res.status(400).json({ error: 'Faltan campos requeridos (licenseNumber, consultationPrice, userId)' });
    }

    const doctor = await prisma.doctorProfile.create({ 
      data: req.body,
      include: {
        user: {
          select: {
            firstName: true,
            lastName: true,
            email: true
          }
        }
      }
    });
    res.status(201).json(doctor);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Error al crear perfil de doctor' });
  }
};

export const getMyAppointments = async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.user?.id;
    if (!userId) {
      return res.status(401).json({ error: 'No autorizado' });
    }

    const doctor = await prisma.doctorProfile.findUnique({
      where: { userId }
    });

    if (!doctor) {
      return res.status(404).json({ error: 'Perfil de doctor no encontrado' });
    }

    const { date } = req.query;
    
    // Filtro base: todas las citas del doctor
    const whereClause: any = {
      doctorProfileId: doctor.id
    };

    // Filtro opcional: si se envía date (YYYY-MM-DD), filtramos por ese día exacto
    if (date && typeof date === 'string') {
      const dateStart = new Date(`${date}T00:00:00.000Z`);
      const dateEnd = new Date(`${date}T23:59:59.999Z`);
      
      whereClause.date = {
        gte: dateStart,
        lte: dateEnd
      };
    }

    const appointments = await prisma.appointment.findMany({
      where: whereClause,
      orderBy: [
        { date: 'asc' },
        { startTime: 'asc' }
      ],
      include: {
        patient: {
          select: {
            firstName: true,
            lastName: true,
            email: true
          }
        },
        service: {
          select: {
            name: true,
            price: true,
            duration: true
          }
        },
        clinicProfile: {
          select: {
            name: true
          }
        }
      }
    });

    res.status(200).json(appointments);
  } catch (error) {
    console.error('[Doctor Controller] Error en getMyAppointments:', error);
    res.status(500).json({ error: 'Error al obtener la agenda del médico' });
  }
};

export const updateDoctorProfile = async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.user?.id;
    if (!userId) return res.status(401).json({ error: 'No autorizado' });

    const doctor = await prisma.doctorProfile.findUnique({ where: { userId } });
    if (!doctor) return res.status(404).json({ error: 'Perfil no encontrado' });

    const { bio, specialties, insurances, languages, isAvailable } = req.body;

    // --- BLOQUE DE VALIDACIÓN ESTRICTA ---especialidades
    if (specialties && Array.isArray(specialties) && specialties.length > 0) {
      const foundSpecialties = await prisma.specialty.findMany({
        where: { name: { in: specialties } }
      });
      if (foundSpecialties.length !== specialties.length) {
        return res.status(400).json({ error: 'Una o más especialidades no existen en el catálogo maestro.' });
      }
    }

    // Validación de catálogo para seguros
    if (insurances && Array.isArray(insurances) && insurances.length > 0) {
      const foundInsurances = await prisma.insurance.findMany({
        where: { name: { in: insurances } }
      });
      if (foundInsurances.length !== insurances.length) {
        return res.status(400).json({ error: 'Uno o más seguros no existen en el catálogo maestro.' });
      }
    }
    // ------------------------------------

    const dataToUpdate: any = {};
    if (bio !== undefined) dataToUpdate.bio = bio;
    if (languages !== undefined && Array.isArray(languages)) dataToUpdate.languages = languages;
    if (isAvailable !== undefined) dataToUpdate.isAvailable = Boolean(isAvailable);
    
    if (specialties && Array.isArray(specialties)) {
      dataToUpdate.specialties = { set: specialties.map((name: string) => ({ name })) };
    }
    
    if (insurances && Array.isArray(insurances)) {
      dataToUpdate.insurances = { set: insurances.map((name: string) => ({ name })) };
    }

    const updatedDoctor = await prisma.doctorProfile.update({
      where: { id: doctor.id },
      data: dataToUpdate,
      include: {
        specialties: true,
        insurances: true
      }
    });

    res.json(updatedDoctor);
  } catch (error) {
    console.error('[Doctor Controller] Error en updateDoctorProfile:', error);
    res.status(500).json({ error: 'Error al actualizar el perfil del doctor' });
  }
};

export const addService = async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.user?.id;
    if (!userId) return res.status(401).json({ error: 'No autorizado' });

    const doctor = await prisma.doctorProfile.findUnique({ where: { userId } });
    if (!doctor) return res.status(404).json({ error: 'Perfil no encontrado' });

    const { name, price, description, duration } = req.body;
    if (!name) return res.status(400).json({ error: 'Faltan campos requeridos (name)' });

    const service = await prisma.service.create({
      data: {
        name,
        price: price ? parseFloat(price) : 0,
        description,
        duration: duration ? parseInt(duration) : null,
        doctorProfileId: doctor.id
      }
    });

    res.status(201).json(service);
  } catch (error) {
    console.error('[Doctor Controller] Error en addService:', error);
    res.status(500).json({ error: 'Error al añadir el servicio' });
  }
};

export const addCertification = async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.user?.id;
    if (!userId) return res.status(401).json({ error: 'No autorizado' });

    const doctor = await prisma.doctorProfile.findUnique({ where: { userId } });
    if (!doctor) return res.status(404).json({ error: 'Perfil no encontrado' });

    const { name, institution, year } = req.body;
    if (!name || !institution) return res.status(400).json({ error: 'Faltan campos requeridos (name, institution)' });

    const certification = await prisma.certification.create({
      data: {
        name,
        institution,
        year: year ? parseInt(year) : null,
        doctorProfileId: doctor.id
      }
    });

    res.status(201).json(certification);
  } catch (error) {
    console.error('[Doctor Controller] Error en addCertification:', error);
    res.status(500).json({ error: 'Error al añadir la certificación' });
  }
};

export const addWorkSchedule = async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.user?.id;
    if (!userId) return res.status(401).json({ error: 'No autorizado' });

    const doctor = await prisma.doctorProfile.findUnique({ where: { userId } });
    if (!doctor) return res.status(404).json({ error: 'Perfil no encontrado' });

    const { clinicId, weekday, timezone, startTime, endTime } = req.body;
    if (!clinicId || weekday === undefined || !startTime || !endTime) {
      return res.status(400).json({ error: 'Faltan campos requeridos (clinicId, weekday, startTime, endTime)' });
    }

    // Validar que el doctor esté activo en esa clínica
    const workplace = await prisma.doctorClinicWorkplace.findUnique({
      where: {
        doctorProfileId_clinicProfileId: {
          doctorProfileId: doctor.id,
          clinicProfileId: clinicId
        }
      }
    });

    if (!workplace || !workplace.isActive) {
      return res.status(403).json({ error: 'No tienes permisos para configurar horarios en esta clínica o la vinculación no está activa' });
    }

    // Crear el horario conectado al workplace
    const schedule = await prisma.workSchedule.create({
      data: {
        weekday: parseInt(weekday),
        timezone: timezone || null,
        startTime,
        endTime,
        workplaceId: workplace.id
      }
    });

    res.status(201).json(schedule);
  } catch (error) {
    console.error('[Doctor Controller] Error en addWorkSchedule:', error);
    res.status(500).json({ error: 'Error al añadir el horario de trabajo' });
  }
};

export const getMySchedules = async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.user?.id;
    const doctor = await prisma.doctorProfile.findUnique({ where: { userId } });
    if (!doctor) return res.status(403).json({ error: 'No autorizado' });

    const schedules = await prisma.workSchedule.findMany({
      where: {
        workplace: { doctorProfileId: doctor.id }
      },
      include: { workplace: { include: { clinicProfile: true } } }
    });

    return res.json(schedules);
  } catch (error) {
    return res.status(500).json({ error: 'Error del servidor' });
  }
};

