import { Prisma } from '../../generated/prisma';
import type { Response } from 'express';
import type { AuthRequest } from '../middlewares/auth.middleware';
import prisma from '../prisma';
import { centsToDollars } from '../utils/money';
import type { CreateDoctorServiceInput, DoctorProfileDto, DoctorServiceDto, UpdateDoctorProfileInput, UpdateDoctorServiceInput, UpdateDoctorServiceStatusInput } from '../dtos/doctor.dto';

type FieldErrors = Record<string, string>;
const MAX_NAME_LENGTH = 120;
const MAX_BIO_LENGTH = 1_000;
const MAX_DESCRIPTION_LENGTH = 1_000;
const MAX_SERVICE_PRICE_CENTS = 100_000_000;
const MAX_DURATION_MINUTES = 24 * 60;

function text(value: unknown, maximum: number): string | null {
  return typeof value === 'string' && value.trim().length > 0 && value.trim().length <= maximum ? value.trim() : null;
}

function optionalText(value: unknown, maximum: number): string | null | undefined {
  if (value === undefined) return undefined;
  if (value === null || value === '') return null;
  return typeof value === 'string' && value.trim().length <= maximum ? value.trim() || null : undefined;
}

function idList(value: unknown, field: string, errors: FieldErrors): string[] | undefined {
  if (value === undefined) return undefined;
  if (!Array.isArray(value) || value.length > 10 || value.some((id) => typeof id !== 'string' || !id.trim())) {
    errors[field] = 'Selecciona una lista válida de máximo 10 elementos.';
    return undefined;
  }
  const ids = value.map((id) => id.trim());
  if (new Set(ids).size !== ids.length) errors[field] = 'No repitas elementos.';
  return ids;
}

function validation(res: Response, fields: FieldErrors) {
  return res.status(422).json({ error: 'VALIDATION_ERROR', message: 'Revisa los campos indicados.', fields });
}

async function ownDoctor(userId: string) {
  return prisma.doctorProfile.findUnique({ where: { userId }, include: { user: true } });
}

async function profileDto(doctorId: string): Promise<DoctorProfileDto | null> {
  const [doctor, availableSpecialties, availableInsurances] = await Promise.all([
    prisma.doctorProfile.findUnique({
      where: { id: doctorId },
      include: { user: true, specialties: { select: { id: true, name: true } }, insurances: { select: { id: true, name: true } } },
    }),
    prisma.specialty.findMany({ select: { id: true, name: true }, orderBy: { name: 'asc' } }),
    prisma.insurance.findMany({ select: { id: true, name: true }, orderBy: { name: 'asc' } }),
  ]);
  if (!doctor) return null;
  return {
    id: doctor.id, firstName: doctor.user.firstName, lastName: doctor.user.lastName, email: doctor.user.email, phone: doctor.user.phone,
    licenseNumber: doctor.licenseNumber, bio: doctor.bio, languages: doctor.languages, profileImageUrl: doctor.profileImageUrl,
    specialties: doctor.specialties, insurances: doctor.insurances, availableSpecialties, availableInsurances,
  };
}

function serviceDto(service: { id: string; name: string; description: string | null; priceCents: number | null; currency: 'USD'; duration: number | null; isActive: boolean; clinicProfileId: string | null }): DoctorServiceDto {
  return { id: service.id, name: service.name, description: service.description, priceCents: service.priceCents ?? 0, currency: service.currency, durationMinutes: service.duration ?? 0, isActive: service.isActive, clinicId: service.clinicProfileId };
}

async function validateClinic(doctorId: string, clinicId: string | null | undefined, errors: FieldErrors) {
  if (!clinicId) return;
  const workplace = await prisma.doctorClinicWorkplace.findUnique({ where: { doctorProfileId_clinicProfileId: { doctorProfileId: doctorId, clinicProfileId: clinicId } } });
  if (!workplace?.isActive) errors.clinicId = 'La clínica no está vinculada activamente a tu perfil.';
}

function validateServiceInput(input: Partial<CreateDoctorServiceInput>, partial: boolean): FieldErrors {
  const errors: FieldErrors = {};
  if (!partial || input.name !== undefined) if (!text(input.name, MAX_NAME_LENGTH)) errors.name = 'El nombre es obligatorio y debe tener máximo 120 caracteres.';
  if (input.description !== undefined && optionalText(input.description, MAX_DESCRIPTION_LENGTH) === undefined) errors.description = 'La descripción debe tener máximo 1000 caracteres.';
  if (!partial || input.priceCents !== undefined) if (!Number.isSafeInteger(input.priceCents) || (input.priceCents ?? -1) < 0 || (input.priceCents ?? 0) > MAX_SERVICE_PRICE_CENTS) errors.priceCents = 'Ingresa un precio entero válido en centavos.';
  if (!partial || input.durationMinutes !== undefined) if (!Number.isSafeInteger(input.durationMinutes) || (input.durationMinutes ?? 0) <= 0 || (input.durationMinutes ?? 0) > MAX_DURATION_MINUTES) errors.durationMinutes = 'La duración debe ser un número entero entre 1 y 1440 minutos.';
  if (input.clinicId !== undefined && input.clinicId !== null && (typeof input.clinicId !== 'string' || !input.clinicId.trim())) errors.clinicId = 'La clínica indicada no es válida.';
  return errors;
}

export async function getMyDoctorProfile(req: AuthRequest, res: Response) {
  const doctor = await ownDoctor(req.user!.id);
  if (!doctor) return res.status(404).json({ error: 'DOCTOR_PROFILE_NOT_FOUND' });
  const dto = await profileDto(doctor.id);
  return res.json(dto);
}

export async function patchMyDoctorProfile(req: AuthRequest, res: Response) {
  const doctor = await ownDoctor(req.user!.id);
  if (!doctor) return res.status(404).json({ error: 'DOCTOR_PROFILE_NOT_FOUND' });
  const input = req.body as UpdateDoctorProfileInput;
  const errors: FieldErrors = {};
  const firstName = input.firstName === undefined ? undefined : text(input.firstName, MAX_NAME_LENGTH);
  const lastName = input.lastName === undefined ? undefined : text(input.lastName, MAX_NAME_LENGTH);
  const phone = optionalText(input.phone, 32);
  const bio = optionalText(input.bio, MAX_BIO_LENGTH);
  const languages = input.languages === undefined ? undefined : idList(input.languages, 'languages', errors);
  const specialtyIds = idList(input.specialtyIds, 'specialtyIds', errors);
  const insuranceIds = idList(input.insuranceIds, 'insuranceIds', errors);
  if (input.firstName !== undefined && !firstName) errors.firstName = 'El nombre es obligatorio y debe tener máximo 120 caracteres.';
  if (input.lastName !== undefined && !lastName) errors.lastName = 'El apellido es obligatorio y debe tener máximo 120 caracteres.';
  if (input.phone !== undefined && phone === undefined) errors.phone = 'El teléfono debe tener máximo 32 caracteres.';
  if (input.bio !== undefined && bio === undefined) errors.bio = 'La biografía debe tener máximo 1000 caracteres.';
  const [specialtyCount, insuranceCount] = await Promise.all([
    specialtyIds === undefined ? Promise.resolve(0) : prisma.specialty.count({ where: { id: { in: specialtyIds } } }),
    insuranceIds === undefined ? Promise.resolve(0) : prisma.insurance.count({ where: { id: { in: insuranceIds } } }),
  ]);
  if (specialtyIds !== undefined && specialtyCount !== specialtyIds.length) errors.specialtyIds = 'Una o más especialidades no existen.';
  if (insuranceIds !== undefined && insuranceCount !== insuranceIds.length) errors.insuranceIds = 'Uno o más seguros no existen.';
  if (Object.keys(errors).length > 0) return validation(res, errors);

  await prisma.$transaction(async (tx) => {
    const userData: Prisma.UserUpdateInput = {};
    if (typeof firstName === 'string') userData.firstName = firstName;
    if (typeof lastName === 'string') userData.lastName = lastName;
    if (phone !== undefined) userData.phone = phone;
    if (Object.keys(userData).length > 0) await tx.user.update({ where: { id: doctor.userId }, data: userData });
    await tx.doctorProfile.update({ where: { id: doctor.id }, data: { ...(bio !== undefined ? { bio } : {}), ...(languages !== undefined ? { languages } : {}), ...(specialtyIds !== undefined ? { specialties: { set: specialtyIds.map((id) => ({ id })) } } : {}), ...(insuranceIds !== undefined ? { insurances: { set: insuranceIds.map((id) => ({ id })) } } : {}) } });
  });
  return res.json(await profileDto(doctor.id));
}

export async function listMyDoctorServices(req: AuthRequest, res: Response) {
  const doctor = await ownDoctor(req.user!.id);
  if (!doctor) return res.status(404).json({ error: 'DOCTOR_PROFILE_NOT_FOUND' });
  const services = await prisma.service.findMany({ where: { doctorProfileId: doctor.id }, orderBy: { createdAt: 'desc' } });
  return res.json({ items: services.map(serviceDto) });
}

export async function createMyDoctorService(req: AuthRequest, res: Response) {
  const doctor = await ownDoctor(req.user!.id);
  if (!doctor) return res.status(404).json({ error: 'DOCTOR_PROFILE_NOT_FOUND' });
  const input = req.body as CreateDoctorServiceInput;
  const errors = validateServiceInput(input, false);
  await validateClinic(doctor.id, input.clinicId, errors);
  if (Object.keys(errors).length > 0) return validation(res, errors);
  const service = await prisma.service.create({ data: { name: input.name.trim(), description: optionalText(input.description, MAX_DESCRIPTION_LENGTH) ?? null, priceCents: input.priceCents, price: centsToDollars(input.priceCents), currency: 'USD', duration: input.durationMinutes, doctorProfileId: doctor.id, clinicProfileId: input.clinicId?.trim() || null } });
  return res.status(201).json(serviceDto(service));
}

export async function patchMyDoctorService(req: AuthRequest, res: Response) {
  const doctor = await ownDoctor(req.user!.id);
  if (!doctor) return res.status(404).json({ error: 'DOCTOR_PROFILE_NOT_FOUND' });
  const service = await prisma.service.findFirst({ where: { id: String(req.params.serviceId), doctorProfileId: doctor.id } });
  if (!service) return res.status(404).json({ error: 'SERVICE_NOT_FOUND' });
  const input = req.body as UpdateDoctorServiceInput;
  const errors = validateServiceInput(input, true);
  await validateClinic(doctor.id, input.clinicId, errors);
  if (Object.keys(errors).length > 0) return validation(res, errors);
  const updated = await prisma.service.update({ where: { id: service.id }, data: { ...(input.name !== undefined ? { name: input.name.trim() } : {}), ...(input.description !== undefined ? { description: optionalText(input.description, MAX_DESCRIPTION_LENGTH) ?? null } : {}), ...(input.priceCents !== undefined ? { priceCents: input.priceCents, price: centsToDollars(input.priceCents) } : {}), ...(input.durationMinutes !== undefined ? { duration: input.durationMinutes } : {}), ...(input.clinicId !== undefined ? { clinicProfileId: input.clinicId?.trim() || null } : {}) } });
  return res.json(serviceDto(updated));
}

export async function patchMyDoctorServiceStatus(req: AuthRequest, res: Response) {
  const doctor = await ownDoctor(req.user!.id);
  if (!doctor) return res.status(404).json({ error: 'DOCTOR_PROFILE_NOT_FOUND' });
  const service = await prisma.service.findFirst({ where: { id: String(req.params.serviceId), doctorProfileId: doctor.id } });
  if (!service) return res.status(404).json({ error: 'SERVICE_NOT_FOUND' });
  const input = req.body as UpdateDoctorServiceStatusInput;
  if (typeof input.isActive !== 'boolean') return validation(res, { isActive: 'Indica si el servicio debe estar activo.' });
  const updated = await prisma.service.update({ where: { id: service.id }, data: { isActive: input.isActive } });
  return res.json(serviceDto(updated));
}
