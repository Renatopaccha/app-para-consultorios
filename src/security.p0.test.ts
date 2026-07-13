import { Request, Response } from 'express';

jest.mock('./prisma', () => ({
  __esModule: true,
  default: {
    user: { findUnique: jest.fn(), update: jest.fn() },
    doctorProfile: { findUnique: jest.fn(), findMany: jest.fn() },
    clinicProfile: { findUnique: jest.fn() },
    assistantProfile: { findUnique: jest.fn() },
    $transaction: jest.fn(),
  },
}));

jest.mock('./services/email.service', () => ({
  emailService: { sendWelcomeEmail: jest.fn(), sendPasswordReset: jest.fn() },
}));

import prisma from './prisma';
import { register, forgotPassword } from './controllers/auth.controller';
import { getDoctors } from './controllers/doctor.controller';
import { canAccessAppointment, canManageClinic } from './services/appointmentAuthorization.service';
import { getJwtSecret } from './utils/jwt';
import { emailService } from './services/email.service';

type MockResponse = {
  status: jest.Mock;
  json: jest.Mock;
};

const response = (): MockResponse => {
  const result: MockResponse = { status: jest.fn(), json: jest.fn() };
  result.status.mockReturnValue(result);
  return result;
};

const prismaMock = prisma as unknown as {
  user: { findUnique: jest.Mock; update: jest.Mock };
  doctorProfile: { findUnique: jest.Mock; findMany: jest.Mock };
  clinicProfile: { findUnique: jest.Mock };
  assistantProfile: { findUnique: jest.Mock };
  $transaction: jest.Mock;
};

beforeEach(() => {
  process.env.JWT_SECRET = 'a'.repeat(32);
  jest.clearAllMocks();
  jest.mocked(emailService.sendWelcomeEmail).mockResolvedValue(undefined);
  jest.mocked(emailService.sendPasswordReset).mockResolvedValue(undefined);
});

describe('P0 security controls', () => {
  it.each(['SUPER_ADMIN', 'DOCTOR', 'CLINIC_ADMIN', 'ASSISTANT'])(
    'public registration ignores attacker supplied %s role',
    async (role) => {
      const createdUser = { id: 'patient-1', email: 'patient@example.test', firstName: 'Pat', lastName: 'Ient', phone: null, role: 'PATIENT' };
      const create = jest.fn().mockResolvedValue(createdUser);
      prismaMock.user.findUnique.mockResolvedValue(null);
      prismaMock.$transaction.mockImplementation(async (callback: (tx: { user: { create: jest.Mock } }) => Promise<unknown>) => callback({ user: { create } }));
      const res = response();

      await register({ body: { email: createdUser.email, password: 'password', firstName: 'Pat', lastName: 'Ient', role } } as unknown as Request, res as unknown as Response);

      expect(create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ role: 'PATIENT' }) }));
      expect(res.status).toHaveBeenCalledWith(201);
    },
  );

  it('denies a patient access to another patient appointment', async () => {
    await expect(canAccessAppointment('patient-a', 'PATIENT', { patientId: 'patient-b', doctorProfileId: 'doctor-1', clinicProfileId: 'clinic-1' })).resolves.toBe(false);
  });

  it('denies a doctor access to another doctor appointment', async () => {
    prismaMock.doctorProfile.findUnique.mockResolvedValue({ id: 'doctor-a' });
    await expect(canAccessAppointment('user-a', 'DOCTOR', { patientId: 'patient-1', doctorProfileId: 'doctor-b', clinicProfileId: 'clinic-1' })).resolves.toBe(false);
  });

  it('denies an assistant access outside of its assignment', async () => {
    prismaMock.assistantProfile.findUnique.mockResolvedValue({ doctorProfileId: 'doctor-a', clinicProfileId: null });
    await expect(canAccessAppointment('assistant-a', 'ASSISTANT', { patientId: 'patient-1', doctorProfileId: 'doctor-b', clinicProfileId: 'clinic-b' })).resolves.toBe(false);
  });

  it('denies a clinic administrator from managing another clinic', async () => {
    prismaMock.clinicProfile.findUnique.mockResolvedValue({ id: 'clinic-a' });
    await expect(canManageClinic('admin-a', 'CLINIC_ADMIN', 'clinic-b')).resolves.toBe(false);
  });

  it('denies a doctor from validating another doctor payment', async () => {
    prismaMock.doctorProfile.findUnique.mockResolvedValue({ id: 'doctor-a' });
    await expect(canAccessAppointment('doctor-user-a', 'DOCTOR', { patientId: 'patient-1', doctorProfileId: 'doctor-b', clinicProfileId: 'clinic-b' })).resolves.toBe(false);
  });

  it('public doctor listing uses an explicit selection without internal token or wallet fields', async () => {
    prismaMock.doctorProfile.findMany.mockResolvedValue([]);
    const res = response();
    await getDoctors({ query: {} } as unknown as Request, res as unknown as Response);
    const query = prismaMock.doctorProfile.findMany.mock.calls[0]?.[0] as { select: Record<string, unknown> };
    expect(query.select).toBeDefined();
    expect(query.select).not.toHaveProperty('walletBalance');
    expect(query.select).not.toHaveProperty('googleAccessToken');
    expect(query.select).not.toHaveProperty('outlookAccessToken');
  });

  it('returns the same forgot-password response for an unknown account', async () => {
    prismaMock.user.findUnique.mockResolvedValue(null);
    const res = response();
    await forgotPassword({ body: { email: 'unknown@example.test' } } as unknown as Request, res as unknown as Response);
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith({ message: 'Si el correo existe en nuestra base de datos, recibirás instrucciones de recuperación.' });
  });

  it('fails JWT configuration without a sufficiently long secret', () => {
    delete process.env.JWT_SECRET;
    expect(getJwtSecret).toThrow('JWT_SECRET must be configured');
    process.env.JWT_SECRET = 'short';
    expect(getJwtSecret).toThrow('JWT_SECRET must be configured');
  });
});
