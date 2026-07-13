import jwt from 'jsonwebtoken';

const MINIMUM_SECRET_LENGTH = 32;

export const getJwtSecret = (): string => {
  const secret = process.env.JWT_SECRET;
  if (!secret || secret.length < MINIMUM_SECRET_LENGTH) {
    throw new Error(`JWT_SECRET must be configured and contain at least ${MINIMUM_SECRET_LENGTH} characters.`);
  }
  return secret;
};

export const generateToken = (payload: object, expiresIn: string = '1d'): string => {
  return jwt.sign(payload, getJwtSecret(), { expiresIn } as jwt.SignOptions);
};

export const verifyToken = (token: string) => {
  try {
    return jwt.verify(token, getJwtSecret());
  } catch (error) {
    return null;
  }
};
