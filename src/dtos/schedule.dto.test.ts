import { parseCreateDoctorAppointment, parseInvitedPatient } from './schedule.dto';

describe('validación de cita manual del doctor', () => {
  const base = { clinicId: ' clinic ', serviceId: ' service ', startsAt: '2026-10-05T09:00:00-05:00', sendEmail: true };

  it('normaliza el paciente invitado y permite phone nulo o ausente', () => {
    const parsed = parseCreateDoctorAppointment({ ...base, patient: { email: '  ANA@EXAMPLE.TEST ', firstName: ' Ana ', lastName: ' Pérez ', phone: null } });
    expect(parsed).toEqual({ success: true, data: { clinicId: 'clinic', serviceId: 'service', startsAt: base.startsAt, sendEmail: true, patient: { kind: 'invited', patient: { email: 'ana@example.test', firstName: 'Ana', lastName: 'Pérez', phone: null } } } });
    expect(parseInvitedPatient({ email: 'ana@example.test', firstName: 'Ana', lastName: 'Pérez' })).toMatchObject({ success: true });
  });

  it.each([
    [{ ...base, patient: { firstName: 'Ana', lastName: 'Pérez' } }, 'patient.email'],
    [{ ...base, patient: { email: 42, firstName: 'Ana', lastName: 'Pérez' } }, 'patient.email'],
    [{ ...base, patient: { email: 'invalido', firstName: 'Ana', lastName: 'Pérez' } }, 'patient.email'],
    [{ ...base, patient: { email: 'ana@example.test', lastName: 'Pérez' } }, 'patient.firstName'],
    [{ ...base, patient: { email: 'ana@example.test', firstName: {}, lastName: 'Pérez' } }, 'patient.firstName'],
    [{ ...base, patient: { email: 'ana@example.test', firstName: 'Ana', lastName: '   ' } }, 'patient.lastName'],
    [{ ...base, patient: { email: 'ana@example.test', firstName: 'Ana', lastName: 'Pérez', phone: 12345 } }, 'patient.phone'],
  ])('rechaza payload inválido en %s', (payload, field) => {
    const parsed = parseCreateDoctorAppointment(payload);
    expect(parsed.success).toBe(false);
    if (!parsed.success) expect(parsed.fields[field]).toBeTruthy();
  });

  it('conserva el contrato de paciente registrado', () => {
    expect(parseCreateDoctorAppointment({ ...base, patient: { id: ' patient-id ' } })).toMatchObject({ success: true, data: { patient: { kind: 'registered', id: 'patient-id' } } });
    expect(parseCreateDoctorAppointment({ ...base, patientId: ' legacy-id' })).toMatchObject({ success: true, data: { patient: { kind: 'registered', id: 'legacy-id' } } });
  });
});
