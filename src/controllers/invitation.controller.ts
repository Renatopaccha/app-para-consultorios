import { Request, Response } from 'express';
import bcrypt from 'bcrypt';
import crypto from 'crypto';
import prisma from '../prisma';
import { AuthRequest } from '../middlewares/auth.middleware';
import { canManageClinic } from '../services/appointmentAuthorization.service';
import { emailService } from '../services/email.service';
import { generateToken } from '../utils/jwt';

const INVITATION_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const invitationRoles = ['DOCTOR', 'CLINIC_ADMIN'] as const;
type InvitationRole = (typeof invitationRoles)[number];

const normalizeEmail = (email: string) => email.trim().toLowerCase();
const isEmail = (email: string) => /^\S+@\S+\.\S+$/.test(email);
const hashInvitationToken = (token: string) => crypto.createHash('sha256').update(token).digest('hex');
const maskEmail = (email: string) => {
  const [local, domain] = email.split('@');
  return `${local?.slice(0, 1) || '*'}***@${domain || '***'}`;
};

const hasActiveInvitation = async (email: string, role: InvitationRole, clinicProfileId: string | null) => prisma.invitation.findFirst({
  where: { email, role, clinicProfileId, acceptedAt: null, revokedAt: null, expiresAt: { gt: new Date() } },
  select: { id: true },
});

const canAdministerInvitation = async (req: AuthRequest, invitation: { clinicProfileId: string | null }) => {
  if (!req.user) return false;
  if (req.user.role === 'SUPER_ADMIN') return true;
  return invitation.clinicProfileId !== null
    && req.user.role === 'CLINIC_ADMIN'
    && canManageClinic(req.user.id, req.user.role, invitation.clinicProfileId);
};

const sendInvitation = async (email: string, role: InvitationRole, token: string, expiresAt: Date) => {
  await emailService.sendInvitationEmail(email, role, token, expiresAt);
};

export const createInvitation = async (req: AuthRequest, res: Response) => {
  try {
    const { email: rawEmail, role, clinicProfileId: requestedClinicId } = req.body as { email?: string; role?: string; clinicProfileId?: string };
    const email = typeof rawEmail === 'string' ? normalizeEmail(rawEmail) : '';
    if (!email || !isEmail(email) || !role || !invitationRoles.includes(role as InvitationRole)) {
      return res.status(400).json({ error: 'Email y rol de invitación válidos son requeridos.' });
    }
    if (!req.user) return res.status(401).json({ error: 'No autorizado' });

    let clinicProfileId: string | null = null;
    if (req.user.role === 'CLINIC_ADMIN') {
      if (role !== 'DOCTOR') return res.status(403).json({ error: 'Una clínica solo puede invitar médicos.' });
      const clinic = await prisma.clinicProfile.findUnique({ where: { userId: req.user.id }, select: { id: true } });
      if (!clinic) return res.status(403).json({ error: 'No tienes una clínica asociada.' });
      clinicProfileId = clinic.id;
    } else if (req.user.role === 'SUPER_ADMIN') {
      clinicProfileId = requestedClinicId || null;
      if (role === 'CLINIC_ADMIN' && clinicProfileId) {
        return res.status(400).json({ error: 'La invitación de administrador de clínica no puede asociarse a una clínica existente.' });
      }
      if (clinicProfileId) {
        const clinic = await prisma.clinicProfile.findUnique({ where: { id: clinicProfileId }, select: { id: true } });
        if (!clinic) return res.status(404).json({ error: 'Clínica no encontrada.' });
      }
    } else {
      return res.status(403).json({ error: 'No tienes permisos para crear invitaciones.' });
    }

    const existingUser = await prisma.user.findUnique({ where: { email }, select: { id: true } });
    if (existingUser) return res.status(409).json({ error: 'Ya existe una cuenta con este correo.' });
    if (await hasActiveInvitation(email, role as InvitationRole, clinicProfileId)) {
      return res.status(409).json({ error: 'Ya existe una invitación activa equivalente.' });
    }

    const token = crypto.randomBytes(32).toString('base64url');
    const expiresAt = new Date(Date.now() + INVITATION_TTL_MS);
    const invitation = await prisma.invitation.create({
      data: { email, role: role as InvitationRole, tokenHash: hashInvitationToken(token), clinicProfileId, invitedByUserId: req.user.id, expiresAt },
      select: { id: true, email: true, role: true, clinicProfileId: true, expiresAt: true, createdAt: true },
    });

    try {
      await sendInvitation(email, role as InvitationRole, token, expiresAt);
    } catch (error) {
      console.error('[InvitationController] Invitation created but email delivery failed:', error instanceof Error ? error.message : error);
      return res.status(202).json({ invitation, delivery: 'pending' });
    }

    return res.status(201).json({
      invitation,
      delivery: 'sent',
      ...(process.env.NODE_ENV === 'test' ? { testToken: token } : {}),
    });
  } catch (error) {
    console.error('[InvitationController] Error creating invitation:', error instanceof Error ? error.message : error);
    return res.status(500).json({ error: 'No se pudo crear la invitación.' });
  }
};

export const listInvitations = async (req: AuthRequest, res: Response) => {
  if (!req.user) return res.status(401).json({ error: 'No autorizado' });
  const where = req.user.role === 'SUPER_ADMIN'
    ? {}
    : req.user.role === 'CLINIC_ADMIN'
      ? { clinicProfile: { userId: req.user.id } }
      : null;
  if (!where) return res.status(403).json({ error: 'No tienes permisos para consultar invitaciones.' });

  const invitations = await prisma.invitation.findMany({
    where,
    orderBy: { createdAt: 'desc' },
    select: { id: true, email: true, role: true, clinicProfileId: true, expiresAt: true, acceptedAt: true, revokedAt: true, createdAt: true },
  });
  return res.json(invitations);
};

export const revokeInvitation = async (req: AuthRequest, res: Response) => {
  const invitation = await prisma.invitation.findUnique({ where: { id: String(req.params.id) }, select: { id: true, clinicProfileId: true, acceptedAt: true, revokedAt: true, expiresAt: true } });
  if (!invitation) return res.status(404).json({ error: 'Invitación no encontrada.' });
  if (!(await canAdministerInvitation(req, invitation))) return res.status(403).json({ error: 'No tienes permisos para revocar esta invitación.' });
  if (invitation.acceptedAt || invitation.revokedAt || invitation.expiresAt <= new Date()) return res.status(409).json({ error: 'La invitación ya no está activa.' });
  await prisma.invitation.update({ where: { id: invitation.id }, data: { revokedAt: new Date() } });
  return res.status(200).json({ message: 'Invitación revocada.' });
};

export const resendInvitation = async (req: AuthRequest, res: Response) => {
  const previous = await prisma.invitation.findUnique({ where: { id: String(req.params.id) } });
  if (!previous) return res.status(404).json({ error: 'Invitación no encontrada.' });
  if (!(await canAdministerInvitation(req, previous))) return res.status(403).json({ error: 'No tienes permisos para reenviar esta invitación.' });
  if (previous.acceptedAt || previous.revokedAt || previous.expiresAt <= new Date()) return res.status(409).json({ error: 'La invitación ya no está activa.' });

  const token = crypto.randomBytes(32).toString('base64url');
  const expiresAt = new Date(Date.now() + INVITATION_TTL_MS);
  const replacement = await prisma.$transaction(async (tx) => {
    await tx.invitation.update({ where: { id: previous.id }, data: { revokedAt: new Date() } });
    return tx.invitation.create({
      data: { email: previous.email, role: previous.role, tokenHash: hashInvitationToken(token), clinicProfileId: previous.clinicProfileId, invitedByUserId: previous.invitedByUserId, expiresAt },
      select: { id: true, email: true, role: true, clinicProfileId: true, expiresAt: true },
    });
  });
  try {
    await sendInvitation(replacement.email, replacement.role as InvitationRole, token, expiresAt);
  } catch (error) {
    console.error('[InvitationController] Invitation regenerated but email delivery failed:', error instanceof Error ? error.message : error);
    return res.status(202).json({ invitation: replacement, delivery: 'pending' });
  }
  return res.status(200).json({ invitation: replacement, delivery: 'sent', ...(process.env.NODE_ENV === 'test' ? { testToken: token } : {}) });
};

export const validateInvitation = async (req: Request, res: Response) => {
  const token = typeof req.query.token === 'string' ? req.query.token : '';
  if (!token) return res.status(400).json({ error: 'El token es requerido.' });
  const invitation = await prisma.invitation.findUnique({ where: { tokenHash: hashInvitationToken(token) } });
  if (!invitation) return res.status(404).json({ valid: false, error: 'Invitación no encontrada.' });
  if (invitation.acceptedAt || invitation.revokedAt || invitation.expiresAt <= new Date()) {
    return res.status(410).json({ valid: false, error: 'La invitación ya no está disponible.' });
  }
  return res.json({ valid: true, emailMasked: maskEmail(invitation.email), role: invitation.role, expiresAt: invitation.expiresAt });
};

export const acceptInvitation = async (req: Request, res: Response) => {
  try {
    const { token, firstName, lastName, password, licenseNumber, consultationPrice, name, address } = req.body as Record<string, unknown>;
    if (typeof token !== 'string' || typeof firstName !== 'string' || typeof lastName !== 'string' || typeof password !== 'string' || password.length < 12) {
      return res.status(400).json({ error: 'Token, nombre, apellido y una contraseña de al menos 12 caracteres son requeridos.' });
    }
    const invitation = await prisma.invitation.findUnique({ where: { tokenHash: hashInvitationToken(token) } });
    if (!invitation) return res.status(404).json({ error: 'Invitación no encontrada.' });
    if (invitation.acceptedAt || invitation.revokedAt || invitation.expiresAt <= new Date()) return res.status(410).json({ error: 'La invitación ya no está disponible.' });
    if (invitation.role === 'DOCTOR' && (typeof licenseNumber !== 'string' || !licenseNumber.trim() || typeof consultationPrice !== 'number' || consultationPrice < 0)) {
      return res.status(400).json({ error: 'La invitación médica requiere licencia profesional y precio de consulta.' });
    }
    if (invitation.role === 'CLINIC_ADMIN' && (typeof name !== 'string' || !name.trim() || typeof address !== 'string' || !address.trim())) {
      return res.status(400).json({ error: 'La invitación de clínica requiere nombre y dirección.' });
    }

    const passwordHash = await bcrypt.hash(password, 12);
    const result = await prisma.$transaction(async (tx) => {
      const claimed = await tx.invitation.updateMany({
        where: { id: invitation.id, acceptedAt: null, revokedAt: null, expiresAt: { gt: new Date() } },
        data: { acceptedAt: new Date() },
      });
      if (claimed.count !== 1) throw new Error('INVITATION_UNAVAILABLE');
      const existing = await tx.user.findUnique({ where: { email: invitation.email }, select: { id: true } });
      if (existing) throw new Error('EMAIL_CONFLICT');
      const user = await tx.user.create({ data: { email: invitation.email, firstName: firstName.trim(), lastName: lastName.trim(), passwordHash, role: invitation.role } });
      if (invitation.role === 'DOCTOR') {
        const doctor = await tx.doctorProfile.create({
          data: { userId: user.id, licenseNumber: (licenseNumber as string).trim(), consultationPrice: consultationPrice as number, verificationStatus: 'PENDING', isVerified: false },
        });
        if (invitation.clinicProfileId) await tx.doctorClinicWorkplace.create({ data: { doctorProfileId: doctor.id, clinicProfileId: invitation.clinicProfileId } });
      } else {
        await tx.clinicProfile.create({ data: { userId: user.id, name: (name as string).trim(), address: (address as string).trim(), verificationStatus: 'PENDING' } });
      }
      return user;
    });
    const tokenForSession = generateToken({ id: result.id, role: result.role });
    return res.status(201).json({ user: { id: result.id, firstName: result.firstName, lastName: result.lastName, email: result.email, role: result.role }, token: tokenForSession, verificationStatus: 'PENDING' });
  } catch (error) {
    if (error instanceof Error && error.message === 'INVITATION_UNAVAILABLE') return res.status(410).json({ error: 'La invitación ya no está disponible.' });
    if (error instanceof Error && error.message === 'EMAIL_CONFLICT') return res.status(409).json({ error: 'Ya existe una cuenta con este correo.' });
    console.error('[InvitationController] Error accepting invitation:', error instanceof Error ? error.message : error);
    return res.status(500).json({ error: 'No se pudo aceptar la invitación.' });
  }
};

export const updateDoctorVerification = async (req: AuthRequest, res: Response) => {
  const { status } = req.body as { status?: string };
  if (!['APPROVED', 'REJECTED', 'SUSPENDED'].includes(status || '')) return res.status(400).json({ error: 'Estado de verificación inválido.' });
  const doctor = await prisma.doctorProfile.update({ where: { id: String(req.params.id) }, data: { verificationStatus: status as 'APPROVED' | 'REJECTED' | 'SUSPENDED', isVerified: status === 'APPROVED', verifiedAt: new Date(), verifiedByUserId: req.user?.id } });
  return res.json({ id: doctor.id, verificationStatus: doctor.verificationStatus });
};

export const updateClinicVerification = async (req: AuthRequest, res: Response) => {
  const { status } = req.body as { status?: string };
  if (!['APPROVED', 'REJECTED', 'SUSPENDED'].includes(status || '')) return res.status(400).json({ error: 'Estado de verificación inválido.' });
  const clinic = await prisma.clinicProfile.update({ where: { id: String(req.params.id) }, data: { verificationStatus: status as 'APPROVED' | 'REJECTED' | 'SUSPENDED', verifiedAt: new Date(), verifiedByUserId: req.user?.id } });
  return res.json({ id: clinic.id, verificationStatus: clinic.verificationStatus });
};
