import { Request, Response, NextFunction } from 'express';
import { verifyToken } from '../utils/jwt';
import prisma from '../prisma';
import { resolveClerkSession } from '../services/clerkSession.service';
import { getClerkMfaStatus, requiresMfa } from '../services/clerkMfa.service';
import { authorizeProfessionalRequest } from '../services/professionalAuthorizationEnforcement.service';
export type Role = 'SUPER_ADMIN' | 'CLINIC_ADMIN' | 'DOCTOR' | 'ASSISTANT' | 'PATIENT';

export interface AuthRequest extends Request {
  user?: {
    id: string;
    role: Role;
  };
  authSource?: 'legacy_jwt' | 'clerk';
}

type ZendaPrincipal = { id: string; role: Role };

const bearerToken = (req: Request) => {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) return null;
  return authHeader.slice('Bearer '.length).trim() || null;
};

const zendaUserById = async (id: string): Promise<ZendaPrincipal | null> => {
  const user = await prisma.user.findUnique({ where: { id }, select: { id: true, role: true } });
  return user ? { id: user.id, role: user.role as Role } : null;
};

const zendaUserByClerkId = async (clerkUserId: string): Promise<ZendaPrincipal | null> => {
  const user = await prisma.user.findUnique({ where: { clerkUserId }, select: { id: true, role: true } });
  return user ? { id: user.id, role: user.role as Role } : null;
};

/**
 * Middleware para validar el JWT y añadir el payload del usuario a la request.
 */
export const authenticate = async (req: AuthRequest, res: Response, next: NextFunction) => {
  const token = bearerToken(req);
  const legacyPayload = token ? verifyToken(token) as { id?: string } | null : null;
  try {
    const [legacyUser, clerkSession] = await Promise.all([
      legacyPayload?.id ? zendaUserById(legacyPayload.id) : Promise.resolve(null),
      Promise.resolve(resolveClerkSession(req)),
    ]);
    const clerkUser = clerkSession ? await zendaUserByClerkId(clerkSession.clerkUserId) : null;

    if (legacyPayload?.id && !legacyUser) {
      return res.status(401).json({ error: 'Sesión no válida', code: 'LEGACY_IDENTITY_NOT_FOUND' });
    }
    if (clerkSession && !clerkUser) {
      return res.status(403).json({ error: 'La identidad Clerk aún no está vinculada a Zenda.', code: 'CLERK_IDENTITY_NOT_LINKED' });
    }
    if (legacyUser && clerkUser && legacyUser.id !== clerkUser.id) {
      return res.status(401).json({ error: 'Las identidades autenticadas no corresponden al mismo usuario.', code: 'AUTH_IDENTITY_CONFLICT' });
    }

    const user = clerkUser ?? legacyUser;
    if (!user) {
      const code = token ? 'AUTH_TOKEN_INVALID_OR_EXPIRED' : 'AUTH_CREDENTIALS_MISSING';
      return res.status(401).json({ error: 'Token inválido o expirado', code });
    }

    // MFA enforcement belongs at the provider-to-Zenda principal boundary. JWT
    // remains deliberately exempt during coexistence; its legacy flow is not
    // being migrated in this phase.
    if (clerkUser && clerkSession && requiresMfa(user.role)) {
      try {
        const mfa = await getClerkMfaStatus(clerkSession.clerkUserId);
        if (!mfa.enabled) {
          return res.status(403).json({
            code: 'MFA_SETUP_REQUIRED',
            message: 'Debes activar la autenticación en dos pasos para acceder con Clerk.',
            mfa: { required: true, enabled: false },
          });
        }
      } catch {
        // Professional access fails closed when Clerk cannot confirm MFA.
        return res.status(503).json({
          code: 'MFA_STATUS_UNAVAILABLE',
          message: 'No se pudo verificar el estado de seguridad de tu cuenta. Intenta nuevamente.',
          mfa: { required: true },
        });
      }
    }
    req.user = user;
    req.authSource = clerkUser ? 'clerk' : 'legacy_jwt';
    return next();
  } catch (error) {
    console.error('[Auth] No se pudo resolver la identidad autenticada:', error instanceof Error ? error.message : 'unknown error');
    return res.status(503).json({ error: 'No se pudo validar la sesión en este momento.', code: 'AUTHENTICATION_UNAVAILABLE' });
  }
};

/**
 * Middleware de autorización RBAC (Role-Based Access Control).
 * @param roles Array de roles permitidos para acceder al endpoint.
 */
export const requireRole = (roles: Role[]) => {
  return async (req: AuthRequest, res: Response, next: NextFunction) => {
    if (!req.user) {
      return res.status(401).json({ error: 'Usuario no autenticado' });
    }

    if (!roles.includes(req.user.role)) {
      return res.status(403).json({ 
        error: 'Forbidden: No tienes permisos suficientes para acceder a este recurso.' 
      });
    }

    if (req.user.role === 'DOCTOR' && roles.includes('DOCTOR')) {
      const authorization = await authorizeProfessionalRequest({
        req,
        userId: req.user.id,
        currentRole: req.user.role,
      });
      if (!authorization.allowed) {
        return res.status(authorization.status).json({
          error: authorization.code,
          code: authorization.code,
          message: authorization.message,
        });
      }
    }

    next();
  };
};

/** Applies the DOCTOR cutover to multi-role endpoints that only use authenticate. */
export const requireProfessionalAccessForDoctor = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction,
) => {
  if (!req.user) return res.status(401).json({ error: 'Usuario no autenticado' });
  if (req.user.role !== 'DOCTOR') return next();
  const authorization = await authorizeProfessionalRequest({
    req,
    userId: req.user.id,
    currentRole: req.user.role,
  });
  if (!authorization.allowed) {
    return res.status(authorization.status).json({
      error: authorization.code,
      code: authorization.code,
      message: authorization.message,
    });
  }
  return next();
};
