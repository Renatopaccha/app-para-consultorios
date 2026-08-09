import { Request, Response } from 'express';
import { AuthRequest } from '../middlewares/auth.middleware';
import * as bcrypt from 'bcrypt';
import prisma from '../prisma';
import { generateToken } from '../utils/jwt';
import { emailService } from '../services/email.service';
import { createOpaqueToken, hashOpaqueToken, isValidEmail, normalizeEmail } from '../services/emailIdentity.service';
import { claimPatientInvitationAppointments } from '../services/patientInvitation.service';
import { profileImageUrls } from '../services/image.service';
import { publicDisplayName } from '../domain/professionalIdentity';
import { AuthIdentityLinkEvent } from '../../generated/prisma';
import { linkClerkIdentity, recordIdentityLinkAudit, AuthIdentityLinkError } from '../services/authIdentityLink.service';
import { resolveVerifiedClerkIdentity } from '../services/clerkSession.service';
import { verifyLegacyPassword } from '../services/legacyCredential.service';
import { availablePortalsForRole, isRequestedPortal, resolvePortalForRole } from '../services/portalAccess.service';

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

    const existingUser = await prisma.user.findUnique({ where: { emailNormalized: email } });
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

    if (!email || typeof password !== 'string' || !password) {
      return res.status(400).json({ error: 'Faltan campos obligatorios (email, password)' });
    }

    const user = await prisma.user.findUnique({ where: { emailNormalized: email } });
    
    if (!user || !user.passwordHash) {
      return res.status(401).json({ error: 'Credenciales inválidas' });
    }

    const isPasswordValid = await verifyLegacyPassword(password, user.passwordHash);
    
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
 * Links a verified Clerk identity to its pre-existing Zenda account only after
 * proof of control of the legacy password. It never creates domain records.
 */
export const linkExistingClerkAccount = async (req: Request, res: Response) => {
  const password = req.body?.password;
  const invalidBody = !req.body || typeof password !== 'string' || !password || Object.keys(req.body).some((key) => key !== 'password');
  if (invalidBody) return res.status(400).json({ error: 'La contraseña es requerida.', code: 'LINK_PASSWORD_REQUIRED' });

  let clerkIdentity;
  try {
    clerkIdentity = await resolveVerifiedClerkIdentity(req);
  } catch {
    return res.status(503).json({ error: 'No se pudo verificar la identidad Clerk. Intenta nuevamente.', code: 'CLERK_IDENTITY_UNAVAILABLE' });
  }
  if (!clerkIdentity) return res.status(401).json({ error: 'Se requiere una sesión Clerk con correo verificado.', code: 'CLERK_VERIFIED_SESSION_REQUIRED' });

  const emailNormalized = normalizeEmail(clerkIdentity.email);
  const user = await prisma.user.findUnique({ where: { emailNormalized }, select: { id: true, emailNormalized: true, passwordHash: true, clerkUserId: true, role: true } });
  if (!user || !user.passwordHash || user.emailNormalized !== emailNormalized) {
    await recordIdentityLinkAudit({ clerkUserId: clerkIdentity.clerkUserId, event: AuthIdentityLinkEvent.LINK_REJECTED, reasonCode: 'LINK_REAUTH_FAILED' });
    return res.status(401).json({ error: 'No fue posible verificar la cuenta Zenda para el enlace.', code: 'LINK_REAUTH_FAILED' });
  }

  const passwordIsValid = await verifyLegacyPassword(password, user.passwordHash);
  if (!passwordIsValid) {
    await recordIdentityLinkAudit({ userId: user.id, actorUserId: user.id, clerkUserId: clerkIdentity.clerkUserId, event: AuthIdentityLinkEvent.LINK_REJECTED, reasonCode: 'LINK_REAUTH_FAILED' });
    return res.status(401).json({ error: 'No fue posible verificar la cuenta Zenda para el enlace.', code: 'LINK_REAUTH_FAILED' });
  }

  try {
    const linked = await linkClerkIdentity({ userId: user.id, actorUserId: user.id, clerkUserId: clerkIdentity.clerkUserId });
    return res.status(200).json({ linked: true, alreadyLinked: !linked.linkedNow, user: { id: user.id, role: user.role } });
  } catch (error) {
    if (error instanceof AuthIdentityLinkError) {
      return res.status(409).json({ error: 'No fue posible vincular esta identidad con la cuenta Zenda.', code: 'CLERK_IDENTITY_LINK_CONFLICT' });
    }
    return res.status(500).json({ error: 'No se pudo completar el enlace de identidad.', code: 'CLERK_IDENTITY_LINK_FAILED' });
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
        doctorProfile: { select: { id: true, profileImageUrl: true, professionCode: true, displayTitle: true, customDisplayTitle: true, specialties: { select: { name: true }, take: 1 } } },
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
        ...(user.doctorProfile ? {
          doctorProfileId: user.doctorProfile.id,
          profileImageUrl: user.doctorProfile.profileImageUrl,
          profileImageAvatarUrl: profileImageUrls(user.doctorProfile.profileImageUrl)?.avatar ?? null,
          professionCode: user.doctorProfile.professionCode,
          displayTitle: user.doctorProfile.displayTitle,
          customDisplayTitle: user.doctorProfile.customDisplayTitle,
          publicDisplayName: publicDisplayName(user.firstName, user.lastName, user.doctorProfile.displayTitle, user.doctorProfile.customDisplayTitle),
          primarySpecialtyName: user.doctorProfile.specialties[0]?.name ?? null,
        } : {}),
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
 * Resolves a requested web portal only after `authenticate` has mapped the
 * identity to the canonical Zenda user and PostgreSQL role. The request body
 * expresses intent; it never grants a role or controls the destination.
 */
export const resolvePortal = (req: AuthRequest, res: Response) => {
  if (!req.user) return res.status(401).json({ error: 'No autorizado' });

  const body = req.body;
  const validBody = body
    && typeof body === 'object'
    && !Array.isArray(body)
    && Object.keys(body).length === 1
    && Object.prototype.hasOwnProperty.call(body, 'portal')
    && isRequestedPortal(body.portal);

  if (!validBody) {
    return res.status(400).json({
      error: 'El portal solicitado no es válido.',
      code: 'INVALID_REQUESTED_PORTAL',
    });
  }

  const resolution = resolvePortalForRole(req.user.role, body.portal);
  if (!resolution) {
    return res.status(403).json({
      error: 'Esta cuenta no tiene acceso al espacio solicitado.',
      code: 'PORTAL_ACCESS_DENIED',
      requestedPortal: body.portal,
      availablePortals: availablePortalsForRole(req.user.role),
    });
  }

  return res.status(200).json(resolution);
};

/**
 * Solicitar recuperación de contraseña (Forgot Password)
 */
export const forgotPassword = async (req: Request, res: Response) => {
  try {
    const rawEmail = req.body?.email;
    const email = typeof rawEmail === 'string' ? normalizeEmail(rawEmail) : '';

    if (!email) {
      return res.status(400).json({ error: 'El email es requerido' });
    }

    const user = await prisma.user.findUnique({ where: { emailNormalized: email } });

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
