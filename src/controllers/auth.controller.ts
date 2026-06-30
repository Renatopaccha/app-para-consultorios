import { Request, Response } from 'express';
import * as bcrypt from 'bcrypt';
import prisma from '../prisma';
import { generateToken } from '../utils/jwt';
import { emailService } from '../services/email.service';

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

    // Envío de correo de bienvenida - Fire and Forget para no bloquear (sin await)
    emailService.sendWelcomeEmail(result.email, result.firstName, result.role).catch(err => {
      console.error('[AuthController] Error silencioso al enviar correo de bienvenida:', err);
    });

    // Generar el token con el ID y el nuevo Rol
    const token = generateToken({ id: result.id, role: result.role });
    const userWithoutPassword = { ...result };
    delete (userWithoutPassword as any).passwordHash;

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
    const userWithoutPassword = { ...user };
    delete (userWithoutPassword as any).passwordHash;

    res.status(200).json({ user: userWithoutPassword, token });
  } catch (error) {
    console.error('[AuthController] Error en login:', error);
    res.status(500).json({ error: 'Error al iniciar sesión' });
  }
};

/**
 * Solicitar recuperación de contraseña (Forgot Password)
 */
export const forgotPassword = async (req: Request, res: Response) => {
  try {
    const { email } = req.body;

    if (!email) {
      return res.status(400).json({ error: 'El email es requerido' });
    }

    const user = await prisma.user.findUnique({ where: { email } });

    // Por seguridad, si el usuario no existe devolvemos 200 OK igual,
    // o un 404 genérico como solicitaste para no revelar correos registrados.
    if (!user) {
      return res.status(404).json({ error: 'Si el correo existe en nuestra base de datos, recibirás un enlace de recuperación.' });
    }

    // Generar un token aleatorio de 6 dígitos numéricos para mayor facilidad de UX
    const resetToken = Math.floor(100000 + Math.random() * 900000).toString();
    
    // Configurar expiración en 15 minutos
    const expiresAt = new Date(Date.now() + 15 * 60 * 1000);

    await prisma.user.update({
      where: { id: user.id },
      data: {
        resetPasswordToken: resetToken,
        resetPasswordExpires: expiresAt
      }
    });

    // Enviar el correo usando Fire and Forget
    emailService.sendPasswordReset(user.email, resetToken).catch(err => {
      console.error('[AuthController] Error silencioso al enviar correo de recuperación:', err);
    });

    res.status(200).json({ message: 'Se han enviado las instrucciones a tu correo electrónico' });
  } catch (error) {
    console.error('[AuthController] Error en forgotPassword:', error);
    res.status(500).json({ error: 'Error al procesar la solicitud de recuperación' });
  }
};

/**
 * Restablecer contraseña usando el token (Reset Password)
 */
export const resetPassword = async (req: Request, res: Response) => {
  try {
    const { token, newPassword } = req.body;

    if (!token || !newPassword) {
      return res.status(400).json({ error: 'El token y la nueva contraseña son requeridos' });
    }

    // Buscar al usuario con el token que no haya expirado
    const user = await prisma.user.findFirst({
      where: {
        resetPasswordToken: token,
        resetPasswordExpires: {
          gt: new Date() // Que la fecha de expiración sea mayor a la fecha actual
        }
      }
    });

    if (!user) {
      return res.status(400).json({ error: 'El token es inválido o ha expirado' });
    }

    // Hashear la nueva contraseña
    const passwordHash = await bcrypt.hash(newPassword, 10);

    // Actualizar la contraseña y limpiar el token
    await prisma.user.update({
      where: { id: user.id },
      data: {
        passwordHash,
        resetPasswordToken: null,
        resetPasswordExpires: null
      }
    });

    res.status(200).json({ message: 'Contraseña actualizada exitosamente' });
  } catch (error) {
    console.error('[AuthController] Error en resetPassword:', error);
    res.status(500).json({ error: 'Error al restablecer la contraseña' });
  }
};
