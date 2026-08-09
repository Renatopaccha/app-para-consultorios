import type { Request, RequestHandler } from 'express';
import { clerkClient, clerkMiddleware, getAuth } from '@clerk/express';
import { getClerkConfig } from '../config/clerk';

export type ClerkSessionIdentity = {
  clerkUserId: string;
  sessionId: string;
};

export type VerifiedClerkIdentity = ClerkSessionIdentity & {
  email: string;
};

/**
 * Clerk is optional during the coexistence phase. Legacy JWT authentication must
 * keep working in environments where the server key has not been configured yet.
 */
export const isClerkConfigured = () => getClerkConfig().status === 'CONFIGURED';

export const clerkSessionMiddleware = (): RequestHandler => {
  const config = getClerkConfig();
  // `server.ts` rejects partial configuration before listening. Keeping app.ts
  // inert here also makes route imports and test bootstraps safe.
  if (config.status !== 'CONFIGURED') return (_req, _res, next) => next();
  return clerkMiddleware({ publishableKey: config.publishableKey, secretKey: config.secretKey });
};

/**
 * Returns only a human Clerk session. API/machine tokens have no sessionId and
 * are deliberately out of scope for this user-authentication migration.
 */
export const resolveClerkSession = (req: Request): ClerkSessionIdentity | null => {
  if (!isClerkConfigured()) return null;

  const auth = getAuth(req);
  if (!auth.isAuthenticated || !auth.userId || !auth.sessionId) return null;

  return { clerkUserId: auth.userId, sessionId: auth.sessionId };
};

/**
 * Loads only the primary, verified email required by the explicit link ceremony.
 * Roles and any Clerk metadata intentionally stay outside this boundary.
 */
export const resolveVerifiedClerkIdentity = async (req: Request): Promise<VerifiedClerkIdentity | null> => {
  const session = resolveClerkSession(req);
  if (!session) return null;

  const user = await clerkClient.users.getUser(session.clerkUserId);
  const email = user.primaryEmailAddress;
  if (user.banned || user.locked || !email || email.verification?.status !== 'verified') return null;

  return { ...session, email: email.emailAddress };
};
