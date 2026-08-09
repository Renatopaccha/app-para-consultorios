jest.mock('@clerk/express', () => ({
  clerkClient: { users: { getUser: jest.fn() } },
}));

import { clerkClient } from '@clerk/express';
import { getClerkMfaStatus, requiresMfa } from './clerkMfa.service';

const getUserMock = jest.mocked(clerkClient.users.getUser);

describe('Clerk MFA policy', () => {
  beforeEach(() => jest.clearAllMocks());

  it.each(['DOCTOR', 'CLINIC_ADMIN', 'ASSISTANT', 'SUPER_ADMIN'] as const)('requires MFA for %s', (role) => {
    expect(requiresMfa(role)).toBe(true);
  });

  it('does not require MFA for PATIENT', () => {
    expect(requiresMfa('PATIENT')).toBe(false);
  });

  it('uses only Clerk Backend User MFA fields and does not inspect metadata', async () => {
    getUserMock.mockResolvedValue({
      twoFactorEnabled: false,
      totpEnabled: true,
      backupCodeEnabled: true,
      publicMetadata: { mfaEnabled: false },
      unsafeMetadata: { mfaEnabled: false },
    } as Awaited<ReturnType<typeof clerkClient.users.getUser>>);

    await expect(getClerkMfaStatus('user_real_clerk_identity')).resolves.toEqual({
      enabled: true,
      totpEnabled: true,
      backupCodeEnabled: true,
    });
    expect(getUserMock).toHaveBeenCalledWith('user_real_clerk_identity');
  });
});
