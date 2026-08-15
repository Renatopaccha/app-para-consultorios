import type { Request } from 'express';
import type { Role } from '../../generated/prisma';
import { getProfessionalAuthMode } from '../config/professionalAuthorization';
import prisma from '../prisma';
import {
  ProfessionalAuthorizationDecision,
  resolveProfessionalAuthorization,
} from './professionalAuthorization.service';

const OBSERVATION_WINDOW_MS = 5 * 60 * 1000;
const MAX_OBSERVATION_KEYS = 5_000;
const lastObservationByKey = new Map<string, number>();

type SafeLogger = Pick<Console, 'info' | 'error'>;

export function professionalAuthShadowEnabled(environment = process.env): boolean {
  return getProfessionalAuthMode(environment) === 'shadow';
}

function safeRequestId(req: Request): string | null {
  const value = req.header('x-request-id');
  return value && value.length <= 120 ? value : null;
}

function shouldLog(key: string, now = Date.now()): boolean {
  const previous = lastObservationByKey.get(key);
  if (previous && now - previous < OBSERVATION_WINDOW_MS) return false;
  if (lastObservationByKey.size >= MAX_OBSERVATION_KEYS) lastObservationByKey.clear();
  lastObservationByKey.set(key, now);
  return true;
}

export function professionalCapabilityForRequest(req: Request): string {
  const routePath = typeof req.route?.path === 'string' ? req.route.path : req.path;
  return `${req.method} ${req.baseUrl}${routePath}`.slice(0, 240);
}

export async function observeProfessionalAuthorization(input: {
  req: Request;
  userId: string;
  currentRole: Role;
  capability?: string;
  doctorProfileId?: string | null;
  logger?: SafeLogger;
}): Promise<ProfessionalAuthorizationDecision | null> {
  if (!professionalAuthShadowEnabled()) return null;
  const logger = input.logger ?? console;
  const capability = input.capability ?? professionalCapabilityForRequest(input.req);

  try {
    const decision = await resolveProfessionalAuthorization(prisma, {
      userId: input.userId,
      currentRole: input.currentRole,
      doctorProfileId: input.doctorProfileId,
    });
    if (decision.discrepancyCode) {
      const key = `${input.userId}:${capability}:${decision.discrepancyCode}:${decision.reasonCode}`;
      if (shouldLog(key)) {
        logger.info('[ProfessionalAuthShadow]', {
          requestId: safeRequestId(input.req),
          userId: input.userId,
          capability,
          legacyAllowed: decision.legacyAllowed,
          newAllowed: decision.professionalAccessAllowed,
          discrepancyCode: decision.discrepancyCode,
          reasonCode: decision.reasonCode,
          timestamp: new Date().toISOString(),
        });
      }
    }
    return decision;
  } catch {
    const key = `${input.userId}:${capability}:SHADOW_RESOLVER_ERROR`;
    if (shouldLog(key)) {
      logger.error('[ProfessionalAuthShadow]', {
        requestId: safeRequestId(input.req),
        userId: input.userId,
        capability,
        discrepancyCode: 'SHADOW_RESOLVER_ERROR',
        timestamp: new Date().toISOString(),
      });
    }
    return null;
  }
}

export function resetProfessionalAuthObservationRateLimitForTests(): void {
  if (process.env.NODE_ENV === 'test') lastObservationByKey.clear();
}
