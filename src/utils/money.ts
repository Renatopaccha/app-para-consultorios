export const MAX_AMOUNT_CENTS = 100_000_000; // USD 1,000,000.00

export function dollarsToCents(value: unknown): number {
  const numeric = typeof value === 'number' ? value : typeof value === 'string' && value.trim() !== '' ? Number(value) : NaN;
  if (!Number.isFinite(numeric) || numeric < 0) throw new Error('El precio debe ser un importe finito mayor o igual a cero.');
  const cents = Math.round((numeric + Number.EPSILON) * 100);
  if (!Number.isSafeInteger(cents) || cents > MAX_AMOUNT_CENTS) throw new Error('El precio excede el límite permitido.');
  return cents;
}

export function centsToDollars(cents: number): number {
  if (!Number.isSafeInteger(cents) || cents < 0 || cents > MAX_AMOUNT_CENTS) throw new Error('Los centavos no son válidos.');
  return cents / 100;
}
