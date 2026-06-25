import { BillingService } from './billing.service';

describe('BillingService', () => {
  describe('calculateMonthlyBilling', () => {
    it('debería cobrar $19 por 1 doctor (Tarifa normal)', () => {
      const result = BillingService.calculateMonthlyBilling(1);
      expect(result).toBe(19);
    });

    it('debería cobrar $76 por exactamente 5 doctores (Descuento del 20% aplicado al bloque)', () => {
      const result = BillingService.calculateMonthlyBilling(5);
      expect(result).toBe(76);
    });

    it('debería cobrar $114 por 7 doctores (1 bloque de 5 con descuento + 2 doctores sueltos)', () => {
      const result = BillingService.calculateMonthlyBilling(7);
      expect(result).toBe(114);
    });

    it('debería devolver 0 para 0 doctores', () => {
      const result = BillingService.calculateMonthlyBilling(0);
      expect(result).toBe(0);
    });

    it('debería cobrar $152 por 10 doctores (2 bloques de 5 con descuento)', () => {
      const result = BillingService.calculateMonthlyBilling(10);
      expect(result).toBe(152);
    });

    it('debería lanzar un error si se pasan números negativos', () => {
      expect(() => BillingService.calculateMonthlyBilling(-1)).toThrow('El número de doctores no puede ser negativo');
    });
  });
});
