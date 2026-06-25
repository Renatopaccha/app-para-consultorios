import { Request, Response, NextFunction } from 'express';
import { verifyToken } from '../utils/jwt';
export type Role = 'PATIENT' | 'DOCTOR' | 'CLINIC_ADMIN' | 'SUPERADMIN';

export interface AuthRequest extends Request {
  user?: {
    id: string;
    role: Role;
  };
}

/**
 * Middleware para validar el JWT y añadir el payload del usuario a la request.
 */
export const authenticate = (req: AuthRequest, res: Response, next: NextFunction) => {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Falta proveer un token o el formato es inválido' });
  }

  const token = authHeader.split(' ')[1];
  if (!token) {
    return res.status(401).json({ error: 'Token no encontrado en el header' });
  }

  try {
    const decoded = verifyToken(token) as { id: string; role: Role };
    req.user = decoded;
    next();
  } catch (error) {
    return res.status(401).json({ error: 'Token inválido o expirado' });
  }
};

/**
 * Middleware de autorización RBAC (Role-Based Access Control).
 * @param roles Array de roles permitidos para acceder al endpoint.
 */
export const requireRole = (roles: Role[]) => {
  return (req: AuthRequest, res: Response, next: NextFunction) => {
    if (!req.user) {
      return res.status(401).json({ error: 'Usuario no autenticado' });
    }

    if (!roles.includes(req.user.role)) {
      return res.status(403).json({ 
        error: 'Forbidden: No tienes permisos suficientes para acceder a este recurso.' 
      });
    }

    next();
  };
};
