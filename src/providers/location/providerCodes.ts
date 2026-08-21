import type { LocationProviderCode } from './contracts';
import { LocationProviderError } from './errors';

export const LOCATION_PROVIDER_CODES = [
  'GOOGLE_PLACES',
  'OPENSTREETMAP',
  'MANUAL',
] as const satisfies readonly LocationProviderCode[];

const LOCATION_PROVIDER_CODE_SET: ReadonlySet<string> = new Set(LOCATION_PROVIDER_CODES);

export function isLocationProviderCode(value: unknown): value is LocationProviderCode {
  return typeof value === 'string' && LOCATION_PROVIDER_CODE_SET.has(value);
}

export function normalizeLocationProviderCode(value: unknown): LocationProviderCode {
  if (typeof value !== 'string') {
    throw new LocationProviderError(
      'LOCATION_PROVIDER_INVALID',
      'El proveedor de ubicación no es válido.',
    );
  }

  const normalized = value.trim().toUpperCase();
  if (!isLocationProviderCode(normalized)) {
    throw new LocationProviderError(
      'LOCATION_PROVIDER_INVALID',
      'El proveedor de ubicación no es válido.',
    );
  }

  return normalized;
}
