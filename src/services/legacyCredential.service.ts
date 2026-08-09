import * as bcrypt from 'bcrypt';

/** Shared legacy-password verification for login and the Clerk link ceremony. */
export const verifyLegacyPassword = (password: string, passwordHash: string): Promise<boolean> => bcrypt.compare(password, passwordHash);
