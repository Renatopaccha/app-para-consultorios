export function getAppointmentCalendarPresentation(a: { status: string; patientConfirmationStatus: string; paymentStatus: string }) {
  if (a.status === 'CANCELLED') return { displayCode: 'CANCELLED', confirmationLabel: 'Cita cancelada', paymentLabel: '', displayLabel: 'Cita cancelada' };
  if (a.status === 'COMPLETED') return a.paymentStatus === 'PAID' ? { displayCode: 'COMPLETED_AND_PAID', confirmationLabel: 'Cita completada', paymentLabel: 'Pagado', displayLabel: 'Cita completada · Pagado' } : { displayCode: 'COMPLETED_PAYMENT_PENDING', confirmationLabel: 'Cita completada', paymentLabel: 'Pago pendiente', displayLabel: 'Cita completada · Pago pendiente' };
  const confirmed = a.patientConfirmationStatus === 'CONFIRMED'; const paid = a.paymentStatus === 'PAID';
  const displayCode = confirmed ? (paid ? 'CONFIRMED_AND_PAID' : 'CONFIRMED_PAYMENT_PENDING') : (paid ? 'CONFIRMATION_PENDING_PAID' : 'CONFIRMATION_PENDING_PAYMENT_PENDING');
  return { displayCode, confirmationLabel: confirmed ? 'Cita confirmada' : 'Confirmación pendiente', paymentLabel: paid ? 'Pagado' : 'Pago pendiente', displayLabel: `${confirmed ? 'Cita confirmada' : 'Confirmación pendiente'} · ${paid ? 'Pagado' : 'Pago pendiente'}` };
}
