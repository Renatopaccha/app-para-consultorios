import { Service } from '../../generated/prisma';

export function buildServiceSnapshot(service: Pick<Service, 'name' | 'priceCents' | 'currency' | 'duration' | 'isActive'>) {
  if (!service.isActive) throw new Error('El servicio no está activo.');
  if (service.priceCents === null || service.duration === null || service.duration <= 0) {
    throw new Error('El servicio no tiene precio o duración canónicos.');
  }
  return {
    serviceNameSnapshot: service.name,
    servicePriceCentsSnapshot: service.priceCents,
    serviceDurationMinutesSnapshot: service.duration,
    currencySnapshot: service.currency,
    paymentAmountCents: service.priceCents,
    paymentCurrency: service.currency,
  };
}
