import { Request, Response } from 'express';
import { AuthRequest } from '../middlewares/auth.middleware';
import prisma from '../prisma';
import { emailService } from '../services/email.service';
import bcrypt from 'bcrypt';

export const getDoctors = async (req: Request, res: Response) => {
  try {
    const page = parseInt(req.query.page as string) || 1;
    const limit = parseInt(req.query.limit as string) || 10;
    const skip = (page - 1) * limit;

    const doctors = await prisma.doctorProfile.findMany({
      skip,
      take: limit,
      select: {
        id: true,
        bio: true,
        profileImageUrl: true,
        consultationPrice: true,
        languages: true,
        user: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
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
        specialties: { select: { id: true, name: true } },
        services: { select: { id: true, name: true, description: true, price: true, duration: true } }
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
      select: {
        id: true,
        bio: true,
        profileImageUrl: true,
        consultationPrice: true,
        languages: true,
        user: { select: { id: true, firstName: true, lastName: true } },
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
        specialties: { select: { id: true, name: true } },
        services: { select: { id: true, name: true, description: true, price: true, duration: true } }
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
  res.status(501).json({ error: 'El aprovisionamiento administrativo de médicos aún no está implementado.' });
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
      return res.status(200).json([]);
    }

    const { date, startDate, endDate } = req.query;
    
    // Filtro base: todas las citas del doctor
    const whereClause: any = {
      doctorProfileId: doctor.id
    };

    if (startDate && typeof startDate === 'string' && endDate && typeof endDate === 'string') {
      whereClause.startDatetime = {
        gte: new Date(startDate),
        lte: new Date(endDate)
      };
    } else if (date && typeof date === 'string' && date !== 'undefined') {
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
            name: true,
            color: true // <-- Vital para pintar el grid del frontend
          }
        }
      }
    });

    // Mapeamos las llaves al contrato que espera el Frontend (snake_case)
    const mappedAppointments = appointments.map(appt => ({
      ...appt,
      payment_status: appt.paymentStatus,
      appointment_type: appt.appointmentType,
      start_datetime: appt.startDatetime,
      patient_name: appt.patient ? `${appt.patient.firstName} ${appt.patient.lastName}` : null
    }));

    res.status(200).json(mappedAppointments);
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

    // Validar colisión de horarios: (A < D) y (B > C)
    const conflictingSchedule = await prisma.workSchedule.findFirst({
      where: {
        weekday: parseInt(weekday),
        workplace: { doctorProfileId: doctor.id },
        startTime: { lt: endTime },
        endTime: { gt: startTime }
      }
    });

    if (conflictingSchedule) {
      return res.status(400).json({ error: 'El horario seleccionado se solapa con un horario existente en otra clínica.' });
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
    if (!doctor) return res.status(200).json([]);

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



export const addAppointment = async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.user?.id;
    if (!userId) return res.status(401).json({ error: 'No autorizado' });

    const doctor = await prisma.doctorProfile.findUnique({ 
      where: { userId },
      include: { user: true }
    });
    if (!doctor) return res.status(404).json({ error: 'Perfil no encontrado' });

    const { clinicId, date, startTime, endTime, type, title, patientId, serviceId } = req.body;
    if (!clinicId || !date || !startTime || !endTime) {
      return res.status(400).json({ error: 'Faltan campos obligatorios' });
    }

    let finalPatientId = patientId;
    let finalServiceId = serviceId;

    if (type === 'bloqueo' || type === 'personal') {
      // Create or find dummy patient for blocks
      let dummyPatient = await prisma.user.findUnique({ where: { email: 'block@vitali.com' } });
      if (!dummyPatient) {
        dummyPatient = await prisma.user.create({
          data: {
            email: 'block@vitali.com',
            passwordHash: 'dummy',
            firstName: 'Bloqueo',
            lastName: 'Sistema',
            role: 'PATIENT'
          }
        });
      }
      finalPatientId = dummyPatient.id;

      // Create or find dummy service
      let dummyService = await prisma.service.findFirst({ where: { name: 'Bloqueo de Horario' } });
      if (!dummyService) {
        dummyService = await prisma.service.create({
          data: {
            name: 'Bloqueo de Horario',
            duration: 60,
            price: 0
          }
        });
      }
      finalServiceId = dummyService.id;
    }

    if (finalServiceId === 'temp-service-123') {
      let tempS = await prisma.service.findFirst();
      if (!tempS) {
        tempS = await prisma.service.create({
          data: {
            name: 'Consulta Temporal',
            duration: 30,
            price: 50
          }
        });
      }
      finalServiceId = tempS.id;
    }

    if (!finalPatientId || !finalServiceId) {


      return res.status(400).json({ error: 'patientId y serviceId son obligatorios para citas médicas' });
    }

    const appointment = await prisma.appointment.create({
      data: {
        patientId: finalPatientId,
        doctorProfileId: doctor.id,
        clinicProfileId: clinicId,
        serviceId: finalServiceId,
        date: new Date(date),
        startTime,
        endTime,
        status: type === 'cita' ? 'CONFIRMED' : 'PENDING',
        notes: title || type
      }
    });

    if (type === 'cita') {
      try {
        const patientData = await prisma.user.findUnique({
          where: { id: finalPatientId },
          select: { email: true, firstName: true }
        });
        
        const clinicData = await prisma.clinicProfile.findUnique({
          where: { id: clinicId },
          select: { name: true }
        });

        if (patientData && patientData.email && clinicData) {
          const formattedDate = new Date(date).toLocaleDateString('es-ES', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });
          emailService.sendDoctorAppointmentConfirmation({
            to: patientData.email,
            patientName: patientData.firstName,
            date: formattedDate,
            time: startTime,
            doctorName: doctor.user.firstName + ' ' + doctor.user.lastName,
            clinicName: clinicData.name
          }).catch(err => console.error("Error async email", err));
        }
      } catch (emailError) {
        console.error("Error intentando enviar correo:", emailError);
      }
    }

    res.status(201).json(appointment);
  } catch (error) {
    console.error('[Doctor Controller] Error en addAppointment:', error);
    res.status(500).json({ error: 'Error al crear el registro' });
  }
};


/**
 * POST /api/doctors/patients/guest
 * Crea una cuenta fantasma (Shadow Account) para pacientes sin registrar.
 * Retorna el ID del usuario creado o del usuario existente.
 */
export const createGuestPatient = async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.user?.id;
    if (!userId) return res.status(401).json({ error: 'No autorizado' });

    // Nota: Aunque recibamos "cedula", en el esquema actual Prisma User no tiene ese campo. 
    // Filtraremos por email principalmente.
    const { firstName, lastName, email, cedula } = req.body;

    if (!firstName || !lastName || !email) {
      return res.status(400).json({ error: 'firstName, lastName y email son obligatorios' });
    }

    // Anti-Enredo: Verificar si ya existe en BD
    let existingUser = await prisma.user.findUnique({
      where: { email }
    });

    if (existingUser) {
      return res.status(200).json({ 
        message: 'Paciente ya existe', 
        patientId: existingUser.id 
      });
    }

    // Crear Shadow Account
    const randomPassword = Math.random().toString(36).slice(-10) + 'A1!'; // Contraseña segura aleatoria
    const salt = await bcrypt.genSalt(10);
    const passwordHash = await bcrypt.hash(randomPassword, salt);

    const newUser = await prisma.user.create({
      data: {
        firstName,
        lastName,
        email,
        passwordHash,
        role: 'PATIENT'
      }
    });

    return res.status(201).json({ 
      message: 'Cuenta fantasma creada exitosamente', 
      patientId: newUser.id 
    });

  } catch (error: any) {
    console.error('[Doctor Controller] Error en createGuestPatient:', error);
    res.status(500).json({ error: 'Error al crear la cuenta fantasma del paciente' });
  }
};

/**
 * GET /api/doctors/patients/search?q={query}
 * Busca pacientes existentes por nombre, apellido o correo.
 */
export const searchPatients = async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.user?.id;
    if (!userId) return res.status(401).json({ error: 'No autorizado' });

    const query = req.query.q as string;
    if (!query || query.length < 2) {
      return res.json([]);
    }

    const patients = await prisma.user.findMany({
      where: {
        role: 'PATIENT',
        OR: [
          { firstName: { contains: query, mode: 'insensitive' } },
          { lastName: { contains: query, mode: 'insensitive' } },
          { email: { contains: query, mode: 'insensitive' } }
        ]
      },
      select: {
        id: true,
        firstName: true,
        lastName: true,
        email: true
      },
      take: 10
    });

    res.json(patients);
  } catch (error) {
    console.error('[Doctor Controller] Error en searchPatients:', error);
    res.status(500).json({ error: 'Error al buscar pacientes' });
  }
};
