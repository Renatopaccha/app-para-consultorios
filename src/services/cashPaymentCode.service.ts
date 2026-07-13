import crypto from 'crypto';

export const CASH_CODE_ALPHABET = '23456789ABCDEFGHJKMNPQRSTUVWXYZ';
export const CASH_CODE_USEFUL_LENGTH = 8;

function secret(): string {
  const value = process.env.CASH_PAYMENT_CODE_SECRET || process.env.JWT_SECRET;
  if (!value) throw new Error('CASH_PAYMENT_CODE_SECRET is required.');
  return value;
}

export function normalizeCashPaymentCode(code: string): string {
  return code.toUpperCase().replace(/[^A-Z0-9]/g, '');
}

export function generateCashPaymentCode(): string {
  let raw = '';
  for (let index = 0; index < CASH_CODE_USEFUL_LENGTH; index += 1) raw += CASH_CODE_ALPHABET[crypto.randomInt(CASH_CODE_ALPHABET.length)];
  return `${raw.slice(0, 4)}-${raw.slice(4)}`;
}

export function hashCashPaymentCode(code: string): string {
  return crypto.createHmac('sha256', secret()).update(normalizeCashPaymentCode(code)).digest('hex');
}

export function hashPaymentSecurityValue(value: string): string {
  return crypto.createHmac('sha256', secret()).update(value).digest('hex');
}

export function cashCodeLast4(code: string): string {
  return normalizeCashPaymentCode(code).slice(-4);
}

export function cashPaymentCodeExpiresAt(appointmentEndsAt: Date): Date {
  const graceHours = Number(process.env.CASH_PAYMENT_GRACE_HOURS || 24);
  if (!Number.isFinite(graceHours) || graceHours < 0) throw new Error('CASH_PAYMENT_GRACE_HOURS must be a non-negative number.');
  return new Date(appointmentEndsAt.getTime() + graceHours * 60 * 60_000);
}

export function cashAmountFromCents(amountCents: number): number {
  return amountCents / 100;
}
