import { CertificationStatus, Prisma, Role } from '../../generated/prisma';
import prisma from '../prisma';
import { deleteCertificationDocument, temporaryCertificationDocumentUrl, uploadCertificationDocument } from './certificationDocument.service';

export class CertificationError extends Error {
  constructor(public readonly status: number, public readonly code: string, message: string) { super(message); }
}

export type CertificationInput = { title?: unknown; institution?: unknown; credentialNumber?: unknown; issuedAt?: unknown; expiresAt?: unknown };

function requiredText(value: unknown, field: string, max: number): string {
  if (typeof value !== 'string' || value.trim().length < 2 || value.trim().length > max) throw new CertificationError(422, 'INVALID_CERTIFICATION', `${field} debe contener entre 2 y ${max} caracteres.`);
  return value.trim();
}
function optionalText(value: unknown, field: string, max: number): string | null | undefined {
  if (value === undefined) return undefined;
  if (value === null || value === '') return null;
  if (typeof value !== 'string' || value.trim().length > max) throw new CertificationError(422, 'INVALID_CERTIFICATION', `${field} no es válido.`);
  return value.trim() || null;
}
function optionalDate(value: unknown, field: string): Date | null | undefined {
  if (value === undefined) return undefined;
  if (value === null || value === '') return null;
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new CertificationError(422, 'INVALID_CERTIFICATION', `${field} debe usar YYYY-MM-DD.`);
  const date = new Date(`${value}T00:00:00.000Z`);
  if (Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== value) throw new CertificationError(422, 'INVALID_CERTIFICATION', `${field} no es una fecha válida.`);
  return date;
}

function certificationData(input: CertificationInput, partial: boolean) {
  const title = partial && input.title === undefined ? undefined : requiredText(input.title, 'title', 160);
  const institution = partial && input.institution === undefined ? undefined : requiredText(input.institution, 'institution', 160);
  const credentialNumber = optionalText(input.credentialNumber, 'credentialNumber', 100);
  const issuedAt = optionalDate(input.issuedAt, 'issuedAt');
  const expiresAt = optionalDate(input.expiresAt, 'expiresAt');
  if (issuedAt && expiresAt && expiresAt < issuedAt) throw new CertificationError(422, 'INVALID_CERTIFICATION', 'expiresAt no puede ser anterior a issuedAt.');
  return { title, institution, credentialNumber, issuedAt, expiresAt };
}

function dto(certification: {
  id: string; title: string; institution: string; credentialNumber: string | null; issuedAt: Date | null; expiresAt: Date | null;
  status: CertificationStatus; rejectionReason: string | null; submittedAt: Date | null; reviewedAt: Date | null; createdAt: Date; updatedAt: Date; documentMimeType: string | null; documentSizeBytes: number | null;
}) {
  return {
    id: certification.id,
    title: certification.title,
    institution: certification.institution,
    credentialNumber: certification.credentialNumber,
    issuedAt: certification.issuedAt?.toISOString().slice(0, 10) ?? null,
    expiresAt: certification.expiresAt?.toISOString().slice(0, 10) ?? null,
    status: certification.status,
    rejectionReason: certification.rejectionReason,
    submittedAt: certification.submittedAt?.toISOString() ?? null,
    reviewedAt: certification.reviewedAt?.toISOString() ?? null,
    createdAt: certification.createdAt.toISOString(),
    updatedAt: certification.updatedAt.toISOString(),
    document: { mimeType: certification.documentMimeType, sizeBytes: certification.documentSizeBytes },
    permissions: { canEdit: certification.status === 'DRAFT' || certification.status === 'REJECTED', canSubmit: certification.status === 'DRAFT' || certification.status === 'REJECTED', canDelete: certification.status === 'DRAFT' || certification.status === 'REJECTED' },
  };
}

async function doctorForUser(userId: string) {
  const doctor = await prisma.doctorProfile.findUnique({ where: { userId }, select: { id: true } });
  if (!doctor) throw new CertificationError(404, 'DOCTOR_PROFILE_NOT_FOUND', 'No existe un perfil médico para esta sesión.');
  return doctor;
}

export async function listMyCertifications(userId: string) {
  const doctor = await doctorForUser(userId);
  const today = new Date();
  today.setUTCHours(0, 0, 0, 0);
  await prisma.certification.updateMany({ where: { doctorProfileId: doctor.id, status: 'APPROVED', expiresAt: { lt: today }, deletedAt: null }, data: { status: 'EXPIRED' } });
  const items = await prisma.certification.findMany({ where: { doctorProfileId: doctor.id, deletedAt: null }, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }] });
  return { items: items.map(dto) };
}

export async function createCertification(userId: string, input: CertificationInput, file: Express.Multer.File | undefined) {
  const doctor = await doctorForUser(userId);
  if (!file) throw new CertificationError(422, 'DOCUMENT_REQUIRED', 'Debes adjuntar el documento profesional.');
  const data = certificationData(input, false);
  const document = await uploadCertificationDocument(file.buffer, file.mimetype, doctor.id);
  try {
    const certification = await prisma.$transaction(async (tx) => {
      const created = await tx.certification.create({ data: { doctorProfileId: doctor.id, title: data.title!, institution: data.institution!, credentialNumber: data.credentialNumber, issuedAt: data.issuedAt, expiresAt: data.expiresAt, year: data.issuedAt?.getUTCFullYear() ?? null, documentUrl: document.privateUrl, documentPublicId: document.publicId, documentMimeType: document.mimeType, documentSizeBytes: document.sizeBytes, documentFormat: document.format, status: 'DRAFT' } });
      await tx.certificationAuditLog.create({ data: { certificationId: created.id, actorUserId: userId, action: 'CREATED' } });
      return created;
    });
    return dto(certification);
  } catch (error) {
    void deleteCertificationDocument(document.publicId, document.mimeType).catch(() => undefined);
    throw error;
  }
}

export async function updateCertification(userId: string, certificationId: string, input: CertificationInput, file?: Express.Multer.File) {
  const doctor = await doctorForUser(userId);
  const current = await prisma.certification.findFirst({ where: { id: certificationId, doctorProfileId: doctor.id, deletedAt: null } });
  if (!current) throw new CertificationError(404, 'CERTIFICATION_NOT_FOUND', 'Certificación no encontrada.');
  if (!['DRAFT', 'REJECTED'].includes(current.status)) throw new CertificationError(409, 'CERTIFICATION_NOT_EDITABLE', 'La certificación no se puede editar en su estado actual.');
  const metadata = certificationData(input, true);
  const document = file ? await uploadCertificationDocument(file.buffer, file.mimetype, doctor.id) : null;
  try {
    const updated = await prisma.$transaction(async (tx) => {
      const record = await tx.certification.update({ where: { id: current.id }, data: {
        ...metadata,
        ...(metadata.issuedAt !== undefined ? { year: metadata.issuedAt?.getUTCFullYear() ?? null } : {}),
        ...(document ? { documentUrl: document.privateUrl, documentPublicId: document.publicId, documentMimeType: document.mimeType, documentSizeBytes: document.sizeBytes, documentFormat: document.format } : {}),
        status: 'DRAFT', rejectionReason: null, submittedAt: null, reviewedAt: null, reviewedByUserId: null,
      } });
      await tx.certificationAuditLog.create({ data: { certificationId: current.id, actorUserId: userId, action: 'EDITED', reason: document ? 'Documento reemplazado' : null } });
      return record;
    });
    if (document && current.documentPublicId && current.documentMimeType) void deleteCertificationDocument(current.documentPublicId, current.documentMimeType).catch(() => undefined);
    return dto(updated);
  } catch (error) {
    if (document) void deleteCertificationDocument(document.publicId, document.mimeType).catch(() => undefined);
    throw error;
  }
}

export async function submitCertification(userId: string, certificationId: string) {
  const doctor = await doctorForUser(userId);
  return prisma.$transaction(async (tx) => {
    const updated = await tx.certification.updateMany({ where: { id: certificationId, doctorProfileId: doctor.id, deletedAt: null, status: { in: ['DRAFT', 'REJECTED'] }, documentPublicId: { not: null } }, data: { status: 'PENDING_REVIEW', rejectionReason: null, submittedAt: new Date(), reviewedAt: null, reviewedByUserId: null } });
    if (updated.count !== 1) {
      const exists = await tx.certification.findFirst({ where: { id: certificationId, doctorProfileId: doctor.id, deletedAt: null }, select: { id: true } });
      throw new CertificationError(exists ? 409 : 404, exists ? 'CERTIFICATION_ALREADY_SUBMITTED' : 'CERTIFICATION_NOT_FOUND', exists ? 'La certificación ya fue enviada o no tiene documento.' : 'Certificación no encontrada.');
    }
    await tx.certificationAuditLog.create({ data: { certificationId, actorUserId: userId, action: 'SUBMITTED' } });
    return dto(await tx.certification.findUniqueOrThrow({ where: { id: certificationId } }));
  });
}

export async function softDeleteCertification(userId: string, certificationId: string) {
  const doctor = await doctorForUser(userId);
  return prisma.$transaction(async (tx) => {
    const updated = await tx.certification.updateMany({ where: { id: certificationId, doctorProfileId: doctor.id, deletedAt: null, status: { in: ['DRAFT', 'REJECTED'] } }, data: { deletedAt: new Date() } });
    if (updated.count !== 1) throw new CertificationError(409, 'CERTIFICATION_NOT_DELETABLE', 'La certificación no existe o no puede eliminarse en su estado actual.');
    await tx.certificationAuditLog.create({ data: { certificationId, actorUserId: userId, action: 'DELETED' } });
  });
}

async function adminScope(userId: string, role: Role): Promise<Prisma.CertificationWhereInput> {
  if (role === 'SUPER_ADMIN') return {};
  if (role !== 'CLINIC_ADMIN') throw new CertificationError(403, 'FORBIDDEN', 'No tienes permisos para revisar certificaciones.');
  const clinic = await prisma.clinicProfile.findUnique({ where: { userId }, select: { id: true } });
  if (!clinic) throw new CertificationError(403, 'CLINIC_PROFILE_NOT_FOUND', 'No existe una clínica para esta sesión.');
  return { doctorProfile: { workplaces: { some: { clinicProfileId: clinic.id, isActive: true } } } };
}

export async function listCertificationsForReview(userId: string, role: Role, status?: string) {
  if (status && !Object.values(CertificationStatus).includes(status as CertificationStatus)) throw new CertificationError(422, 'INVALID_CERTIFICATION_STATUS', 'Estado de certificación inválido.');
  const scope = await adminScope(userId, role);
  const items = await prisma.certification.findMany({ where: { ...scope, deletedAt: null, ...(status ? { status: status as CertificationStatus } : {}) }, include: { doctorProfile: { select: { user: { select: { firstName: true, lastName: true } } } } }, orderBy: { submittedAt: 'asc' } });
  return { items: items.map((item) => ({ ...dto(item), doctorDisplayName: `${item.doctorProfile.user.firstName} ${item.doctorProfile.user.lastName}`.trim() })) };
}

export async function reviewCertification(userId: string, role: Role, certificationId: string, action: unknown, reason: unknown) {
  const scope = await adminScope(userId, role);
  if (action !== 'APPROVE' && action !== 'REJECT') throw new CertificationError(422, 'INVALID_REVIEW_ACTION', 'action debe ser APPROVE o REJECT.');
  const rejectionReason = action === 'REJECT' ? requiredText(reason, 'reason', 500) : null;
  return prisma.$transaction(async (tx) => {
    const existing = await tx.certification.findFirst({ where: { id: certificationId, ...scope, deletedAt: null }, select: { id: true, status: true, doctorProfile: { select: { userId: true } } } });
    if (!existing) throw new CertificationError(404, 'CERTIFICATION_NOT_FOUND', 'Certificación no encontrada en tu alcance.');
    if (existing.doctorProfile.userId === userId) throw new CertificationError(403, 'SELF_REVIEW_FORBIDDEN', 'No puedes revisar tu propia certificación.');
    const changed = await tx.certification.updateMany({ where: { id: certificationId, status: 'PENDING_REVIEW', deletedAt: null }, data: { status: action === 'APPROVE' ? 'APPROVED' : 'REJECTED', rejectionReason, reviewedAt: new Date(), reviewedByUserId: userId } });
    if (changed.count !== 1) throw new CertificationError(409, 'CERTIFICATION_NOT_PENDING', 'La certificación ya fue revisada o no está pendiente.');
    await tx.certificationAuditLog.create({ data: { certificationId, actorUserId: userId, action: action === 'APPROVE' ? 'APPROVED' : 'REJECTED', reason: rejectionReason } });
    return dto(await tx.certification.findUniqueOrThrow({ where: { id: certificationId } }));
  });
}

export async function certificationDocumentForReviewer(userId: string, role: Role, certificationId: string) {
  const scope = await adminScope(userId, role);
  const certification = await prisma.certification.findFirst({ where: { id: certificationId, ...scope, deletedAt: null }, select: { documentPublicId: true, documentFormat: true, documentMimeType: true } });
  if (!certification?.documentPublicId || !certification.documentFormat || !certification.documentMimeType) throw new CertificationError(404, 'DOCUMENT_NOT_FOUND', 'Documento no encontrado.');
  return { url: temporaryCertificationDocumentUrl(certification.documentPublicId, certification.documentFormat, certification.documentMimeType), expiresInSeconds: 300 };
}
