import type { Request } from 'express';
import type { Role } from '../../generated/prisma';
import { getProfessionalAuthMode } from '../config/professionalAuthorization';
import prisma from '../prisma';
import {
  type ProfessionalAuthorizationDecision,
  resolveProfessionalAuthorization,
} from './professionalAuthorization.service';
import {
  observeProfessionalAuthorization,
  professionalCapabilityForRequest,
} from './professionalAuthorizationShadow.service';

const LOG_WINDOW_MS = 5 * 60 * 1000;
const lastLogByKey = new Map<string, number>();

export type ProfessionalAccessApiCode =
  | 'PROFESSIONAL_ACCESS_REQUIRED'
  | 'PROFESSIONAL_ACCESS_SUSPENDED'
  | 'PROFESSIONAL_ACCESS_REVOKED'
  | 'PROFESSIONAL_ROLE_REVOKED'
  | 'PROFESSIONAL_PROFILE_INCONSISTENT'
  | 'PROFESSIONAL_AUTHORIZATION_UNAVAILABLE';

export type ProfessionalRequestAuthorization =
  | { allowed: true; mode: 'legacy' | 'shadow' | 'enforce'; decision: ProfessionalAuthorizationDecision | null }
  | { allowed: false; mode: 'enforce'; status: 403 | 503; code: ProfessionalAccessApiCode; message: string; decision: ProfessionalAuthorizationDecision | null };

type SafeLogger = Pick<Console, 'info' | 'error'>;

function shouldLog(key: string): boolean {
  const now = Date.now();
  const previous = lastLogByKey.get(key);
  if (previous && now - previous < LOG_WINDOW_MS) return false;
  if (lastLogByKey.size >= 5_000) lastLogByKey.clear();
  lastLogByKey.set(key, now);
  return true;
}

function requestId(req: Request): string | null {
  const value = req.header('x-request-id');
  return value && value.length <= 120 ? value : null;
}

function denialFor(decision: ProfessionalAuthorizationDecision): {
  code: ProfessionalAccessApiCode;
  message: string;
} {
  if (decision.reasonCode === 'ROLE_ASSIGNMENT_REVOKED') {
    return { code: 'PROFESSIONAL_ROLE_REVOKED', message: 'Tu capacidad profesional no está habilitada.' };
  }
  if (decision.reasonCode === 'ACCESS_NOT_ACTIVE' && decision.professionalAccessStatus === 'SUSPENDED') {
    return { code: 'PROFESSIONAL_ACCESS_SUSPENDED', message: 'Tu acceso profesional está suspendido.' };
  }
  if (decision.reasonCode === 'ACCESS_NOT_ACTIVE' && decision.professionalAccessStatus === 'REVOKED') {
    return { code: 'PROFESSIONAL_ACCESS_REVOKED', message: 'Tu acceso profesional fue revocado.' };
  }
  if (['PROFILE_USER_MISMATCH', 'USER_NOT_FOUND'].includes(decision.reasonCode ?? '')) {
    return { code: 'PROFESSIONAL_PROFILE_INCONSISTENT', message: 'No fue posible validar el acceso profesional.' };
  }
  return {
    code: 'PROFESSIONAL_ACCESS_REQUIRED',
    message: 'Tu acceso profesional aún no está habilitado.',
  };
}

function logEnforcement(input: {
  req: Request;
  userId: string;
  capability: string;
  logger: SafeLogger;
  code: ProfessionalAccessApiCode;
  decision: ProfessionalAuthorizationDecision | null;
}): void {
  const key = `${input.userId}:${input.capability}:${input.code}`;
  if (!shouldLog(key)) return;
  const payload = {
    requestId: requestId(input.req),
    userId: input.userId,
    capability: input.capability,
    event: 'PROFESSIONAL_AUTH_ENFORCEMENT_DENIED',
    code: input.code,
    professionalAccessStatus: input.decision?.professionalAccessStatus ?? null,
    timestamp: new Date().toISOString(),
  };
  if (['PROFESSIONAL_PROFILE_INCONSISTENT', 'PROFESSIONAL_AUTHORIZATION_UNAVAILABLE'].includes(input.code)) {
    input.logger.error('[ProfessionalAuthEnforcement]', payload);
  } else {
    input.logger.info('[ProfessionalAuthEnforcement]', payload);
  }
}

export async function authorizeProfessionalRequest(input: {
  req: Request;
  userId: string;
  currentRole: Role;
  capability?: string;
  logger?: SafeLogger;
}): Promise<ProfessionalRequestAuthorization> {
  const mode = getProfessionalAuthMode();
  if (mode === 'legacy') return { allowed: true, mode, decision: null };
  if (mode === 'shadow') {
    void observeProfessionalAuthorization(input);
    return { allowed: true, mode, decision: null };
  }

  const logger = input.logger ?? console;
  const capability = input.capability ?? professionalCapabilityForRequest(input.req);
  try {
    const decision = await resolveProfessionalAuthorization(prisma, {
      userId: input.userId,
      currentRole: input.currentRole,
    });
    if (decision.professionalAccessAllowed) return { allowed: true, mode, decision };
    const denial = denialFor(decision);
    logEnforcement({ ...input, capability, logger, ...denial, decision });
    return { allowed: false, mode, status: 403, ...denial, decision };
  } catch {
    const denial = {
      code: 'PROFESSIONAL_AUTHORIZATION_UNAVAILABLE' as const,
      message: 'No se pudo validar el acceso profesional en este momento.',
    };
    logEnforcement({ ...input, capability, logger, ...denial, decision: null });
    return { allowed: false, mode, status: 503, ...denial, decision: null };
  }
}

export function resetProfessionalAuthEnforcementRateLimitForTests(): void {
  if (process.env.NODE_ENV === 'test') lastLogByKey.clear();
}
