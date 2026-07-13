import prisma from '../prisma';
import { PaymentActor } from './cashPaymentAuthorization.service';
import { confirmCashPayment, lookupCashPayment } from './cashPayment.service';

/** @deprecated Remove after clients migrate to /api/cash-payments/:paymentId/confirm. */
export async function confirmLegacyCashPayment(code: string, actor: PaymentActor, ip: string) {
  const lookup = await lookupCashPayment(code, actor, ip);
  const payment = await confirmCashPayment(lookup.paymentId, code, `legacy-cash-${actor.id}-${lookup.paymentId}`, actor, ip);
  const appointment = await prisma.appointment.findUniqueOrThrow({ where: { id: payment.appointment.id } });
  return { appointment, payment };
}
