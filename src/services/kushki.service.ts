import prisma from '../prisma';

export class KushkiService {
  private static readonly API_URL = 'https://api.kushkipagos.com';
  // En producción, asegúrate de tener KUSHKI_PRIVATE_MERCHANT_ID en tu archivo .env
  private static readonly MERCHANT_ID = process.env.KUSHKI_PRIVATE_MERCHANT_ID || '';

  /**
   * Realiza un cargo único a la tarjeta del paciente por el monto de la consulta.
   * Cambia el estado de la cita a PAID y suma el dinero al walletBalance del doctor.
   * 
   * @param token El token de la tarjeta generado por Kushki.js en el frontend
   * @param amount El costo total de la consulta
   * @param doctorId El ID del doctor que atenderá
   * @param appointmentId El ID de la cita que se está pagando
   */
  static async chargePatientForAppointment(token: string, amount: number, doctorId: string, appointmentId: string) {
    try {
      // 1. Ejecutar el cargo usando el API de Kushki
      const response = await fetch(`${this.API_URL}/card/v1/charges`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Private-Merchant-Id': this.MERCHANT_ID
        },
        body: JSON.stringify({
          token: token,
          amount: {
            subtotalIva0: amount,
            iva: 0,
            subtotalIva: 0,
            total: amount
          },
          fullResponse: true
        })
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(`Kushki API Error: ${errorData.message || 'Falló el procesamiento del pago'}`);
      }

      const paymentData = await response.json();

      // 2. Transacción de base de datos atómica (para evitar inconsistencias si una de las dos falla)
      await prisma.$transaction(async (tx) => {
        // Actualizar el estado de la cita
        await tx.appointment.update({
          where: { id: appointmentId },
          data: {
            paymentStatus: 'PAID',
            paymentId: paymentData.ticketNumber // Kushki devuelve ticketNumber
          }
        });

        // Sumar al saldo del doctor
        await tx.doctor.update({
          where: { id: doctorId },
          data: {
            walletBalance: {
              increment: amount
            }
          }
        });
      });

      return paymentData;
    } catch (error) {
      console.error('[KushkiService] Error en chargePatientForAppointment:', error);
      throw new Error(error instanceof Error ? error.message : 'Error desconocido al procesar el pago del paciente');
    }
  }

  /**
   * Realiza el cobro automático de suscripción para una clínica usando su token guardado.
   * 
   * @param clinicId El ID de la clínica
   * @param amount El monto calculado de suscripción (ej. provisto por BillingService)
   */
  static async chargeClinicSubscription(clinicId: string, amount: number) {
    try {
      const clinic = await prisma.clinic.findUnique({
        where: { id: clinicId },
        select: { kushkiCardToken: true }
      });

      if (!clinic) {
        throw new Error('La clínica no existe');
      }

      if (!clinic.kushkiCardToken) {
        throw new Error('La clínica no tiene un método de pago (Kushki Token) configurado');
      }

      // Ejecutar el cargo de suscripción usando el API de Kushki
      const response = await fetch(`${this.API_URL}/card/v1/charges`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Private-Merchant-Id': this.MERCHANT_ID
        },
        body: JSON.stringify({
          token: clinic.kushkiCardToken,
          amount: {
            subtotalIva0: amount,
            iva: 0,
            subtotalIva: 0,
            total: amount
          },
          fullResponse: true
        })
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(`Kushki API Error: ${errorData.message || 'Falló el cobro de la suscripción'}`);
      }

      const paymentData = await response.json();

      // Aquí podrías actualizar el 'subscriptionValidUntil' si lo maneja la clínica.
      // O guardar un recibo de pago en una tabla Invoice.

      return paymentData;
    } catch (error) {
      console.error('[KushkiService] Error en chargeClinicSubscription:', error);
      throw new Error(error instanceof Error ? error.message : 'Error desconocido al procesar el pago de la clínica');
    }
  }
}
