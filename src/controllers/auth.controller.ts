import { Request, Response } from 'express';
import bcrypt from 'bcrypt';
import prisma from '../prisma';
import { generateToken } from '../utils/jwt';

export const register = async (req: Request, res: Response) => {
  try {
    const { 
      email, 
      password, 
      firstName, 
      lastName, 
      phone, 
      role, 
      
      // Campos específicos para DOCTOR
      licenseNumber, 
      consultationPrice, 
      clinicProfileId,
      
      // Campos específicos para CLINIC_ADMIN
      name, 
      address 
    } = req.body;

    if (!email || !password || !firstName || !lastName || !role) {
      return res.status(400).json({ error: 'Faltan campos obligatorios para el registro (email, password, firstName, lastName, role)' });
    }

    // Validar que el rol sea uno de los permitidos por el enum de Prisma
    const validRoles = ['SUPER_ADMIN', 'CLINIC_ADMIN', 'DOCTOR', 'ASSISTANT', 'PATIENT'];
    if (!validRoles.includes(role)) {
      return res.status(400).json({ error: 'Rol inválido. Roles permitidos: ' + validRoles.join(', ') });
    }

    const existingUser = await prisma.user.findUnique({ where: { email } });
    if (existingUser) {
      return res.status(400).json({ error: 'El email ya está registrado' });
    }

    const passwordHash = await bcrypt.hash(password, 10);

    // Utilizamos $transaction para asegurar atomicidad. Si falla la creación del perfil, 
    // el usuario no se crea, evitando usuarios "fantasma" sin perfil.
    const result = await prisma.$transaction(async (tx) => {
      // 1. Preparamos el payload base del modelo User
      const userData: any = {
        email,
        passwordHash,
        firstName,
        lastName,
        phone,
        role,
      };

      // 2. Anidamos la creación del perfil especializado dependiendo del rol
      if (role === 'DOCTOR') {
        userData.doctorProfile = {
          create: {
            licenseNumber: licenseNumber || `TEMP-${Date.now()}`,
            consultationPrice: consultationPrice ? Number(consultationPrice) : 0,
            ...(clinicProfileId ? {
              workplaces: {
                create: [
                  { clinicProfileId: clinicProfileId }
                ]
              }
            } : {})
          }
        };
      } else if (role === 'CLINIC_ADMIN') {
        if (!name || !address) {
          throw new Error('REQ_CLINIC_FIELDS'); // Lanzamos un error capturable si faltan campos
        }
        userData.clinicProfile = {
          create: {
            name,
            address,
          }
        };
      }
      // Los roles SUPER_ADMIN, PATIENT, y ASSISTANT (si no requieren datos adicionales por ahora) 
      // simplemente se crean como usuarios sin perfiles extendidos, tal como lo solicitaste.

      // Configuramos el include para devolver el perfil creado en la respuesta (útil para el frontend)
      const includeData: any = {};
      if (role === 'DOCTOR') includeData.doctorProfile = { include: { workplaces: true } };
      if (role === 'CLINIC_ADMIN') includeData.clinicProfile = true;

      // 3. Ejecutamos la creación unificada
      const user = await tx.user.create({
        data: userData,
        include: Object.keys(includeData).length > 0 ? includeData : undefined
      });

      return user;
    });

    // Generar el token con el ID y el nuevo Rol
    const token = generateToken({ id: result.id, role: result.role });
    const { passwordHash: _, ...userWithoutPassword } = result;

    res.status(201).json({ user: userWithoutPassword, token });
  } catch (error: any) {
    console.error('[AuthController] Error en register:', error);
    if (error.message === 'REQ_CLINIC_FIELDS') {
      return res.status(400).json({ error: 'Para el rol CLINIC_ADMIN se requieren los campos name y address' });
    }
    res.status(500).json({ error: 'Error al registrar el usuario' });
  }
};

export const login = async (req: Request, res: Response) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({ error: 'Faltan campos obligatorios (email, password)' });
    }

    const user = await prisma.user.findUnique({ where: { email } });
    
    if (!user || !user.passwordHash) {
      return res.status(401).json({ error: 'Credenciales inválidas' });
    }

    const isPasswordValid = await bcrypt.compare(password, user.passwordHash);
    
    if (!isPasswordValid) {
      return res.status(401).json({ error: 'Credenciales inválidas' });
    }

    const token = generateToken({ id: user.id, role: user.role });
    const { passwordHash: _, ...userWithoutPassword } = user;

    res.status(200).json({ user: userWithoutPassword, token });
  } catch (error) {
    console.error('[AuthController] Error en login:', error);
    res.status(500).json({ error: 'Error al iniciar sesión' });
  }
};
