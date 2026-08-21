export type LocationProviderErrorCode =
  | 'LOCATION_PROVIDER_INVALID'
  | 'LOCATION_PROVIDER_NOT_CONFIGURED'
  | 'LOCATION_PROVIDER_NOT_SEARCHABLE';

export class LocationProviderError extends Error {
  constructor(
    public readonly code: LocationProviderErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'LocationProviderError';
  }
}
