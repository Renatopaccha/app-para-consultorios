import { Request, Response } from 'express';
import { AuthRequest } from '../middlewares/auth.middleware';
import prisma from '../prisma';
import { canManageClinic } from '../services/appointmentAuthorization.service';
import { normalizeEmail } from '../services/emailIdentity.service';

export const getClinics = async (req: Request, res: Response) => {
  try {
    const page = parseInt(req.query.page as string) || 1;
    const limit = parseInt(req.query.limit as string) || 10;
    const skip = (page - 1) * limit;

    const clinics = await prisma.clinicProfile.findMany({
      where: { verificationStatus: 'APPROVED' },
      skip,
      take: limit,
      select: {
        id: true,
        name: true,
        address: true,
        latitude: true,
        longitude: true,
        createdAt: true,
        updatedAt: true,
      },
    });
    res.json(clinics);
  } catch (error) {
    res.status(500).json({ error: 'Error al obtener clínicas' });
  }
};

export const getClinicById = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;

    const clinic = await prisma.clinicProfile.findFirst({ 
      where: { id: id as string, verificationStatus: 'APPROVED' },
      select: {
        id: true,
        name: true,
        address: true,
        latitude: true,
        longitude: true,
        createdAt: true,
        updatedAt: true,
      },
    });

    if (!clinic) {
      return res.status(404).json({ error: 'Clínica no encontrada' });
    }

    res.json(clinic);
  } catch (error) {
    res.status(500).json({ error: 'Error al obtener clínica' });
  }
};

export const createClinic = async (req: Request, res: Response) => {
  res.status(501).json({ error: 'El aprovisionamiento administrativo de clínicas aún no está implementado.' });
};

/**
 * Añadir un médico a la clínica (Híbrido)
 */
export const addDoctorToClinic = async (req: AuthRequest, res: Response) => {
  try {
    const { clinicProfileId } = req.params;
    const { email } = req.body;

    if (!email) {
      return res.status(400).json({ error: 'El email del doctor es requerido' });
    }

    const clinic = await prisma.clinicProfile.findUnique({ where: { id: clinicProfileId as string }, select: { id: true } });
    if (!clinic) return res.status(404).json({ error: 'Clínica no encontrada' });
    if (!req.user || !(await canManageClinic(req.user.id, req.user.role, clinic.id))) {
      return res.status(403).json({ error: 'No tienes permisos para modificar esta clínica' });
    }

    // 1. Buscar al User por email y verificar que tenga DoctorProfile
    const userDoctor = await prisma.user.findUnique({
      where: { emailNormalized: normalizeEmail(email) },
      include: { doctorProfile: true }
    });

    if (!userDoctor || !userDoctor.doctorProfile) {
      return res.status(404).json({ error: 'No se encontró un doctor con ese email' });
    }

    const doctorProfileId = userDoctor.doctorProfile.id;

    // 2. Upsert en DoctorClinicWorkplace
    const workplace = await prisma.doctorClinicWorkplace.upsert({
      where: {
        doctorProfileId_clinicProfileId: {
          doctorProfileId: doctorProfileId as string,
          clinicProfileId: clinicProfileId as string
        }
      },
      update: {
        isActive: true,
        joinedAt: new Date(),
        leftAt: null // Limpiamos la fecha de salida si estaba inactivo
      },
      create: {
        doctorProfileId: doctorProfileId as string,
        clinicProfileId: clinicProfileId as string,
        isActive: true
      }
    });

    res.status(200).json({ message: 'Doctor añadido a la clínica exitosamente', workplace });
  } catch (error) {
    console.error('[ClinicController] Error en addDoctorToClinic:', error);
    res.status(500).json({ error: 'Error al añadir el doctor a la clínica' });
  }
};

/**
 * Dar de baja a un médico de la clínica (Desactivación lógica)
 */
export const removeDoctorFromClinic = async (req: AuthRequest, res: Response) => {
  try {
    const { clinicProfileId, doctorProfileId } = req.params;
    const clinic = await prisma.clinicProfile.findUnique({ where: { id: clinicProfileId as string }, select: { id: true } });
    if (!clinic) return res.status(404).json({ error: 'Clínica no encontrada' });
    if (!req.user || !(await canManageClinic(req.user.id, req.user.role, clinic.id))) {
      return res.status(403).json({ error: 'No tienes permisos para modificar esta clínica' });
    }
    const doctor = await prisma.doctorProfile.findUnique({ where: { id: doctorProfileId as string }, select: { id: true } });
    if (!doctor) return res.status(404).json({ error: 'Médico no encontrado' });

    const workplace = await prisma.doctorClinicWorkplace.update({
      where: {
        doctorProfileId_clinicProfileId: {
          doctorProfileId: doctorProfileId as string,
          clinicProfileId: clinicProfileId as string
        }
      },
      data: {
        isActive: false,
        leftAt: new Date()
      }
    });

    res.status(200).json({ message: 'Doctor dado de baja de la clínica exitosamente', workplace });
  } catch (error: any) {
    console.error('[ClinicController] Error en removeDoctorFromClinic:', error);
    if (error.code === 'P2025') {
      return res.status(404).json({ error: 'El doctor no está afiliado a esta clínica' });
    }
    res.status(500).json({ error: 'Error al dar de baja al doctor' });
  }
};

/**
 * Obtener todos los doctores activos de una clínica
 */
export const getClinicDoctors = async (req: Request, res: Response) => {
  try {
    const { clinicProfileId } = req.params;

    const workplaces = await prisma.doctorClinicWorkplace.findMany({
      where: {
        clinicProfileId: clinicProfileId as string,
        isActive: true
      },
      include: {
        doctorProfile: {
          select: {
            id: true,
            bio: true,
            profileImageUrl: true,
            consultationPrice: true,
            specialties: { select: { id: true, name: true } },
            user: { select: { firstName: true, lastName: true } },
          }
        }
      }
    });

    // Mapeamos para devolver una lista limpia de doctores con su información de usuario
    const doctors = workplaces.map(wp => ({
      ...wp.doctorProfile,
      joinedAt: wp.joinedAt // Útil para mostrar desde cuándo trabaja ahí
    }));

    res.status(200).json(doctors);
  } catch (error) {
    console.error('[ClinicController] Error en getClinicDoctors:', error);
    res.status(500).json({ error: 'Error al obtener los doctores de la clínica' });
  }
};

export const getMyClinics = async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.user?.id;
    const doctor = await prisma.doctorProfile.findUnique({ where: { userId } });
    if (!doctor) return res.status(200).json([]);

    const workplaces = await prisma.doctorClinicWorkplace.findMany({
      where: { doctorProfileId: doctor.id, isActive: true },
      include: { clinicProfile: { select: { id: true, name: true, address: true, phone: true, logoUrl: true, latitude: true, longitude: true, color: true } } }
    });

    const clinics = workplaces.map(wp => wp.clinicProfile);
    return res.json(clinics);
  } catch (error) {
    return res.status(500).json({ error: 'Error del servidor' });
  }
};
