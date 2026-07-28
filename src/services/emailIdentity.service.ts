import crypto from 'crypto';

export const normalizeEmail = (value: string): string => value.trim().toLowerCase();
export const isValidEmail = (value: string): boolean => /^\S+@\S+\.\S+$/.test(value);
export const hashOpaqueToken = (token: string): string => crypto.createHash('sha256').update(token).digest('hex');
export const createOpaqueToken = (): string => crypto.randomBytes(32).toString('base64url');
export const canExposeDevelopmentToken = (environment = process.env.NODE_ENV): boolean => environment === 'development' || environment === 'test';

