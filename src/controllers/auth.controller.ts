import { Request, Response } from 'express';
import { AuthRequest } from '../middlewares/auth.middleware';
import * as bcrypt from 'bcrypt';
import prisma from '../prisma';
import { generateToken } from '../utils/jwt';
import { emailService } from '../services/email.service';
import { createOpaqueToken, hashOpaqueToken, isValidEmail, normalizeEmail } from '../services/emailIdentity.service';
import { claimPatientInvitationAppointments } from '../services/patientInvitation.service';

const EMAIL_VERIFICATION_TTL_MS = 24 * 60 * 60 * 1000;

export const register = async (req: Request, res: Response) => {
  try {
    const { 
      email: rawEmail, 
      password, 
      firstName, 
      lastName, 
      phone, 
      // Public registration deliberately ignores role and privileged profile fields.
    } = req.body;

    const email = typeof rawEmail === 'string' ? normalizeEmail(rawEmail) : '';
    if (!email || !isValidEmail(email) || !password || !firstName || !lastName) {
      return res.status(400).json({ error: 'Faltan campos obligatorios para el registro (email, password, firstName, lastName)' });
    }

    const existingUser = await prisma.user.findFirst({ where: { OR: [{ emailNormalized: email }, { email }] } });
    if (existingUser) {
      return res.status(400).json({ error: 'El email ya está registrado' });
    }

    const passwordHash = await bcrypt.hash(password, 10);
    const verificationToken = createOpaqueToken();

    // Utilizamos $transaction para asegurar atomicidad. Si falla la creación del perfil, 
    // el usuario no se crea, evitando usuarios "fantasma" sin perfil.
    const result = await prisma.$transaction(async (tx) => {
      // 1. Creamos al usuario base
      const user = await tx.user.create({
        data: {
          email,
          emailNormalized: email,
          passwordHash,
          firstName,
          lastName,
          phone,
          role: 'PATIENT',
          emailVerificationTokenHash: hashOpaqueToken(verificationToken),
          emailVerificationExpires: new Date(Date.now() + EMAIL_VERIFICATION_TTL_MS),
        }
      });

      return user;
    });

    // Envío de correo de bienvenida - Fire and Forget para no bloquear (sin await)
    emailService.sendWelcomeEmail(result.email, result.firstName, result.role).catch(err => {
      console.error('[AuthController] Error silencioso al enviar correo de bienvenida:', err);
    });
    emailService.sendEmailVerificationEmail({ to: result.email, firstName: result.firstName, token: verificationToken }).catch(err => {
      console.error('[AuthController] Error silencioso al enviar verificación:', err);
    });

    // Generar el token con el ID y el nuevo Rol
    const token = generateToken({ id: result.id, role: result.role });
    
    // Devolver un objeto usuario limpio para que el frontend no colapse al buscar relaciones vacías
    const userWithoutPassword = { 
      id: result.id,
      email: result.email,
      firstName: result.firstName,
      lastName: result.lastName,
      role: result.role,
      phone: result.phone
    };

    res.status(201).json({ user: userWithoutPassword, token });
  } catch (error: any) {
    console.error('[AuthController] Error en register:', error);
    res.status(500).json({ error: 'Error al registrar el usuario' });
  }
};

/** Verifies control of the email address and atomically claims invited appointments. */
export const verifyEmail = async (req: Request, res: Response) => {
  const token = typeof req.body?.token === 'string' ? req.body.token : '';
  if (!token) return res.status(400).json({ error: 'El token es requerido.' });
  try {
    const result = await prisma.$transaction(async (tx) => {
      const user = await tx.user.findUnique({ where: { emailVerificationTokenHash: hashOpaqueToken(token) } });
      if (!user || !user.emailVerificationExpires || user.emailVerificationExpires <= new Date()) throw new Error('INVALID_OR_EXPIRED_TOKEN');
      const verified = await tx.user.update({ where: { id: user.id }, data: { emailVerifiedAt: new Date(), emailVerificationTokenHash: null, emailVerificationExpires: null } });
      const claimedAppointments = await claimPatientInvitationAppointments(tx, verified.id, verified.emailNormalized || normalizeEmail(verified.email));
      return { user: verified, claimedAppointments };
    });
    return res.json({ verified: true, claimedAppointments: result.claimedAppointments });
  } catch (error) {
    if (error instanceof Error && error.message === 'INVALID_OR_EXPIRED_TOKEN') return res.status(410).json({ error: 'El token no es válido o expiró.' });
    console.error('[AuthController] Error verifying email:', error);
    return res.status(500).json({ error: 'No se pudo verificar el correo.' });
  }
};

export const login = async (req: Request, res: Response) => {
  try {
  const { email: rawEmail, password } = req.body;
  const email = typeof rawEmail === 'string' ? normalizeEmail(rawEmail) : '';

    if (!email || !password) {
      return res.status(400).json({ error: 'Faltan campos obligatorios (email, password)' });
    }

    const user = await prisma.user.findFirst({ where: { OR: [{ emailNormalized: email }, { email }] } });
    
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
 * Restores the authenticated principal from the database instead of trusting
 * a user object cached by a browser. It intentionally exposes no password,
 * reset token, provider token or financial/medical data.
 */
export const me = async (req: AuthRequest, res: Response) => {
  if (!req.user) return res.status(401).json({ error: 'No autorizado' });

  try {
    const user = await prisma.user.findUnique({
      where: { id: req.user.id },
      select: {
        id: true,
        email: true,
        firstName: true,
        lastName: true,
        phone: true,
        role: true,
        doctorProfile: { select: { id: true } },
        clinicProfile: { select: { id: true } },
        assistantProfile: { select: { id: true } },
      },
    });

    if (!user) return res.status(401).json({ error: 'Sesión no válida' });

    return res.json({
      id: user.id,
      email: user.email,
      firstName: user.firstName,
      lastName: user.lastName,
      phone: user.phone,
      role: user.role,
      profile: {
        ...(user.doctorProfile ? { doctorProfileId: user.doctorProfile.id } : {}),
        ...(user.clinicProfile ? { clinicProfileId: user.clinicProfile.id } : {}),
        ...(user.assistantProfile ? { assistantProfileId: user.assistantProfile.id } : {}),
      },
    });
  } catch (error) {
    console.error('[AuthController] Error en me:', error);
    return res.status(500).json({ error: 'Error al recuperar la sesión' });
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

    const genericResponse = { message: 'Si el correo existe en nuestra base de datos, recibirás instrucciones de recuperación.' };

    // Always return the same response to prevent account enumeration.
    if (!user) {
      return res.status(200).json(genericResponse);
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

    res.status(200).json(genericResponse);
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
