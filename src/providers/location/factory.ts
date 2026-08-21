import type { LocationProviderCode, LocationSearchProvider } from './contracts';
import { LocationProviderError } from './errors';
import { normalizeLocationProviderCode } from './providerCodes';

type SearchProviderCode = Exclude<LocationProviderCode, 'MANUAL'>;
export type LocationProviderRegistry = Partial<Record<SearchProviderCode, LocationSearchProvider>>;

const EMPTY_REGISTRY: LocationProviderRegistry = Object.freeze({});

export function getLocationSearchProvider(
  providerCode: unknown,
  registry: LocationProviderRegistry = EMPTY_REGISTRY,
): LocationSearchProvider {
  const code = normalizeLocationProviderCode(providerCode);
  if (code === 'MANUAL') {
    throw new LocationProviderError(
      'LOCATION_PROVIDER_NOT_SEARCHABLE',
      'La ubicación manual no utiliza un proveedor de búsqueda.',
    );
  }

  const provider = registry[code];
  if (!provider || provider.code !== code) {
    throw new LocationProviderError(
      'LOCATION_PROVIDER_NOT_CONFIGURED',
      `El proveedor de ubicación ${code} no está configurado.`,
    );
  }

  return provider;
}
