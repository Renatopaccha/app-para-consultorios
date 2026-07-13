import { CASH_CODE_ALPHABET, CASH_CODE_USEFUL_LENGTH, cashAmountFromCents, cashPaymentCodeExpiresAt, generateCashPaymentCode, hashCashPaymentCode, normalizeCashPaymentCode } from './cashPaymentCode.service';
import { getAppointmentCalendarPresentation } from './appointmentCalendarPresentation.service';

describe('cash payment code domain', () => {
  beforeAll(() => { process.env.CASH_PAYMENT_CODE_SECRET = 'unit-test-payment-secret'; process.env.CASH_PAYMENT_GRACE_HOURS = '24'; });

  it('generates an eight-character useful code with a readable dash', () => {
    const code = generateCashPaymentCode();
    expect(code).toMatch(/^[2-9A-HJ-KM-NP-Z]{4}-[2-9A-HJ-KM-NP-Z]{4}$/);
    expect(normalizeCashPaymentCode(code)).toHaveLength(CASH_CODE_USEFUL_LENGTH);
  });

  it('excludes ambiguous characters from its alphabet', () => {
    expect(CASH_CODE_ALPHABET).not.toMatch(/[0O1IL]/);
    for (let index = 0; index < 100; index += 1) expect(generateCashPaymentCode()).not.toMatch(/[0O1IL]/);
  });

  it('hashes deterministically without storing formatting and separates different codes', () => {
    expect(hashCashPaymentCode('Z7K9-M4QP')).toBe(hashCashPaymentCode('z7k9m4qp'));
    expect(hashCashPaymentCode('Z7K9-M4QP')).not.toBe(hashCashPaymentCode('Z7K9-M4QX'));
    expect(hashCashPaymentCode('Z7K9-M4QP')).toHaveLength(64);
  });

  it('derives expiration from appointment end and converts cents', () => {
    expect(cashPaymentCodeExpiresAt(new Date('2026-09-01T15:30:00.000Z'))).toEqual(new Date('2026-09-02T15:30:00.000Z'));
    expect(cashAmountFromCents(3550)).toBe(35.5);
  });

  it('uses Payment status before the legacy appointment mirror', () => {
    expect(getAppointmentCalendarPresentation({ status: 'PENDING', patientConfirmationStatus: 'CONFIRMED', paymentStatus: 'PAID', cashPayment: { status: 'PENDING' } }).displayCode).toBe('CONFIRMED_PAYMENT_PENDING');
    expect(getAppointmentCalendarPresentation({ status: 'PENDING', patientConfirmationStatus: 'CONFIRMED', paymentStatus: 'PENDING_CASH', cashPayment: { status: 'CONFIRMED' } }).displayCode).toBe('CONFIRMED_AND_PAID');
  });
});
