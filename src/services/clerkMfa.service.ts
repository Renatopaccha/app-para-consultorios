import { clerkClient } from '@clerk/express';
import type { Role } from '../middlewares/auth.middleware';

export type ClerkMfaStatus = {
  enabled: boolean;
  totpEnabled: boolean;
  backupCodeEnabled: boolean;
};

/**
 * Zenda owns authorization roles; Clerk is authoritative only for the current
 * MFA enrollment state of its authenticated user.
 */
export const requiresMfa = (role: Role): boolean => (
  role === 'DOCTOR'
  || role === 'CLINIC_ADMIN'
  || role === 'ASSISTANT'
  || role === 'SUPER_ADMIN'
);

/**
 * Backup codes are recovery material, not an MFA factor on their own. A
 * supported primary MFA factor is required before protected Clerk access.
 */
export const getClerkMfaStatus = async (clerkUserId: string): Promise<ClerkMfaStatus> => {
  const user = await clerkClient.users.getUser(clerkUserId);
  const totpEnabled = Boolean(user.totpEnabled);

  return {
    enabled: Boolean(user.twoFactorEnabled) || totpEnabled,
    totpEnabled,
    backupCodeEnabled: Boolean(user.backupCodeEnabled),
  };
};
