import { readFileSync } from 'fs';
import { join } from 'path';
import type {
  LocationSearchProvider,
  LocationSuggestion,
  ResolvedLocation,
} from './contracts';
import { LocationProviderError } from './errors';
import { getLocationSearchProvider } from './factory';
import {
  isLocationProviderCode,
  LOCATION_PROVIDER_CODES,
  normalizeLocationProviderCode,
} from './providerCodes';

function expectProviderError(action: () => unknown, code: LocationProviderError['code']) {
  try {
    action();
    throw new Error('Se esperaba un LocationProviderError.');
  } catch (error) {
    expect(error).toBeInstanceOf(LocationProviderError);
    expect(error).toMatchObject({ code, name: 'LocationProviderError' });
  }
}

const googleStub: LocationSearchProvider = {
  code: 'GOOGLE_PLACES',
  async autocomplete() {
    return [];
  },
  async resolvePlace() {
    return {
      providerType: 'GOOGLE_PLACES',
      providerPlaceId: 'stub-place',
      coordinates: { latitude: -0.180653, longitude: -78.467834 },
      precision: 'EXACT',
      address: { countryCode: 'EC', city: 'Quito' },
    };
  },
};

describe('location provider contract', () => {
  it('normaliza códigos conocidos y valida la allowlist explícita', () => {
    expect(LOCATION_PROVIDER_CODES).toEqual(['GOOGLE_PLACES', 'OPENSTREETMAP', 'MANUAL']);
    expect(normalizeLocationProviderCode('  google_places ')).toBe('GOOGLE_PLACES');
    expect(normalizeLocationProviderCode('openstreetmap')).toBe('OPENSTREETMAP');
    expect(normalizeLocationProviderCode('MANUAL')).toBe('MANUAL');
    expect(isLocationProviderCode('GOOGLE_PLACES')).toBe(true);
    expect(isLocationProviderCode('google_places')).toBe(false);
  });

  it('rechaza un providerType desconocido con un error controlado', () => {
    expectProviderError(
      () => normalizeLocationProviderCode('UNKNOWN_MAPS'),
      'LOCATION_PROVIDER_INVALID',
    );
  });

  it('produce un error controlado si el proveedor no está configurado', () => {
    expectProviderError(
      () => getLocationSearchProvider('GOOGLE_PLACES'),
      'LOCATION_PROVIDER_NOT_CONFIGURED',
    );
  });

  it('devuelve el stub configurado para tests', () => {
    expect(getLocationSearchProvider('GOOGLE_PLACES', { GOOGLE_PLACES: googleStub })).toBe(googleStub);
  });

  it('trata MANUAL como una ubicación sin proveedor de búsqueda', () => {
    expectProviderError(
      () => getLocationSearchProvider('MANUAL'),
      'LOCATION_PROVIDER_NOT_SEARCHABLE',
    );
  });

  it('mantiene los DTOs serializables y libres de tipos de SDK externos', () => {
    const suggestion: LocationSuggestion = {
      providerType: 'OPENSTREETMAP',
      providerPlaceId: 'place-1',
      primaryText: 'Av. República',
      secondaryText: 'Quito, Ecuador',
    };
    const location: ResolvedLocation = {
      providerType: 'MANUAL',
      providerPlaceId: 'manual-1',
      coordinates: { latitude: -0.180653, longitude: -78.467834 },
      precision: 'APPROXIMATE',
      address: {
        countryCode: 'EC',
        administrativeArea1: 'Pichincha',
        city: 'Quito',
        street1: 'Av. República',
      },
      attribution: 'Proveedor de prueba',
    };

    expect(JSON.parse(JSON.stringify({ suggestion, location }))).toEqual({ suggestion, location });

    for (const file of ['contracts.ts', 'errors.ts', 'factory.ts', 'index.ts', 'providerCodes.ts']) {
      const source = readFileSync(join(__dirname, file), 'utf8');
      expect(source).not.toMatch(/google\.maps|mapbox/i);
    }
  });
});
