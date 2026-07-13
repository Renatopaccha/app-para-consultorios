import { ipKeyGenerator, rateLimit } from 'express-rate-limit';
import { AuthRequest } from './auth.middleware';

const windowMs = Math.max(1, Number(process.env.CASH_CODE_LOCK_MINUTES || 15)) * 60_000;
const handler = (_req: unknown, res: any) => res.status(429).json({ error: 'CASH_PAYMENT_CODE_UNAVAILABLE', message: 'El código no está disponible para esta operación.' });

export const cashPaymentIpRateLimit = rateLimit({ windowMs, limit: 60, standardHeaders: true, legacyHeaders: false, handler });
export const cashPaymentUserRateLimit = rateLimit({ windowMs, limit: 30, standardHeaders: true, legacyHeaders: false, keyGenerator: (req: AuthRequest) => req.user?.id || ipKeyGenerator(req.ip || 'unknown'), handler });
