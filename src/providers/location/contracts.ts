export type LocationProviderCode = 'GOOGLE_PLACES' | 'OPENSTREETMAP' | 'MANUAL';

export interface LocationSearchProvider {
  readonly code: Exclude<LocationProviderCode, 'MANUAL'>;
  autocomplete(input: {
    query: string;
    countryCodes?: string[];
    sessionToken: string;
    locale?: string;
  }): Promise<LocationSuggestion[]>;
  resolvePlace(input: {
    providerPlaceId: string;
    sessionToken: string;
    locale?: string;
  }): Promise<ResolvedLocation>;
}

export interface LocationSuggestion {
  providerType: LocationProviderCode;
  providerPlaceId: string;
  primaryText: string;
  secondaryText?: string;
}

export interface ResolvedLocation {
  providerType: LocationProviderCode;
  providerPlaceId: string;
  coordinates: { latitude: number; longitude: number };
  precision: 'EXACT' | 'APPROXIMATE' | 'CITY';
  address: {
    countryCode?: string;
    administrativeArea1?: string;
    administrativeArea2?: string;
    city?: string;
    street1?: string;
    postalCode?: string;
  };
  attribution?: string;
}
