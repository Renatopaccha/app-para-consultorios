import request from 'supertest';
import app from '../../app';
import prisma, { disconnectPrisma } from '../../prisma';
import { setCertificationUploadAdapterForTests } from '../../services/certificationDocument.service';
import { generateToken } from '../../utils/jwt';
import { assertIntegrationDatabase, clearIntegrationDatabase } from './testDatabase';

const validPdf = Buffer.from('%PDF-1.4\n1 0 obj\n<< /Type /Page >>\nendobj\n%%EOF', 'ascii');

async function user(email: string, role: 'DOCTOR' | 'SUPER_ADMIN' | 'CLINIC_ADMIN' | 'PATIENT') {
  return prisma.user.create({ data: { email, emailNormalized: email, firstName: role, lastName: 'Pruebas', passwordHash: 'test-only', role } });
}

describe('certificaciones profesionales privadas con PostgreSQL', () => {
  beforeEach(async () => {
    assertIntegrationDatabase();
    await clearIntegrationDatabase();
    let upload = 0;
    setCertificationUploadAdapterForTests(async (_buffer, options) => ({ secureUrl: `https://res.cloudinary.com/test/authenticated/private-${++upload}`, publicId: `private-document-${upload}`, format: options.resource_type === 'raw' ? 'pdf' : 'png' }));
  });
  afterAll(async () => { setCertificationUploadAdapterForTests(); await clearIntegrationDatabase(); await disconnectPrisma(); });

  it('crea borrador privado, valida archivo, aísla propietarios y evita doble envío', async () => {
    const [doctorUser, otherDoctorUser] = await Promise.all([user('cert-doctor@zenda.test', 'DOCTOR'), user('cert-other@zenda.test', 'DOCTOR')]);
    const doctor = await prisma.doctorProfile.create({ data: { userId: doctorUser.id, licenseNumber: 'CERT-1', consultationPrice: 40 } });
    await prisma.doctorProfile.create({ data: { userId: otherDoctorUser.id, licenseNumber: 'CERT-2', consultationPrice: 40 } });
    const token = generateToken({ id: doctorUser.id, role: 'DOCTOR' });
    const created = await request(app).post('/api/doctors/me/certifications').set('Authorization', `Bearer ${token}`)
      .field('title', 'Cardiología clínica').field('institution', 'Universidad de Pruebas').field('issuedAt', '2020-01-01').field('credentialNumber', 'CRED-001')
      .attach('document', validPdf, { filename: 'certificado.pdf', contentType: 'application/pdf' }).expect(201);
    expect(created.body).toMatchObject({ title: 'Cardiología clínica', status: 'DRAFT', document: { mimeType: 'application/pdf', sizeBytes: validPdf.length }, permissions: { canEdit: true, canSubmit: true, canDelete: true } });
    expect(JSON.stringify(created.body)).not.toMatch(/documentUrl|documentPublicId|cloudinary|private-document/);

    const stored = await prisma.certification.findUniqueOrThrow({ where: { id: created.body.id } });
    expect(stored.documentUrl).toContain('/authenticated/');
    expect(await prisma.certificationAuditLog.count({ where: { certificationId: stored.id, action: 'CREATED' } })).toBe(1);

    const otherToken = generateToken({ id: otherDoctorUser.id, role: 'DOCTOR' });
    await request(app).patch(`/api/doctors/me/certifications/${stored.id}`).set('Authorization', `Bearer ${otherToken}`).field('title', 'Ataque').expect(404);
    const otherList = await request(app).get('/api/doctors/me/certifications').set('Authorization', `Bearer ${otherToken}`).expect(200);
    expect(otherList.body.items).toEqual([]);

    const falseMime = await request(app).post('/api/doctors/me/certifications').set('Authorization', `Bearer ${token}`)
      .field('title', 'Documento falso').field('institution', 'Institución')
      .attach('document', validPdf, { filename: 'falso.png', contentType: 'image/png' }).expect(422);
    expect(['UNSUPPORTED_IMAGE', 'DOCUMENT_CONTENT_TYPE_MISMATCH']).toContain(falseMime.body.error);

    const submitted = await request(app).post(`/api/doctors/me/certifications/${stored.id}/submit`).set('Authorization', `Bearer ${token}`).expect(200);
    expect(submitted.body.status).toBe('PENDING_REVIEW');
    await request(app).post(`/api/doctors/me/certifications/${stored.id}/submit`).set('Authorization', `Bearer ${token}`).expect(409);
    await request(app).patch(`/api/doctors/me/certifications/${stored.id}`).set('Authorization', `Bearer ${token}`).field('title', 'Cambio tardío').expect(409);
    expect(await prisma.certificationAuditLog.count({ where: { certificationId: stored.id, action: 'SUBMITTED' } })).toBe(1);
  });

  it('revisión exige alcance, audita aprobación/rechazo y solo publica metadatos aprobados', async () => {
    const [doctorUser, superAdmin, clinicAdmin, foreignClinicAdmin, patient] = await Promise.all([
      user('review-cert-doctor@zenda.test', 'DOCTOR'), user('review-cert-super@zenda.test', 'SUPER_ADMIN'), user('review-cert-clinic@zenda.test', 'CLINIC_ADMIN'), user('review-cert-foreign@zenda.test', 'CLINIC_ADMIN'), user('review-cert-patient@zenda.test', 'PATIENT'),
    ]);
    const doctor = await prisma.doctorProfile.create({ data: { userId: doctorUser.id, licenseNumber: 'CERT-REVIEW', consultationPrice: 40, verificationStatus: 'APPROVED' } });
    const clinic = await prisma.clinicProfile.create({ data: { userId: clinicAdmin.id, name: 'Clínica vinculada', address: 'Quito', verificationStatus: 'APPROVED' } });
    await prisma.clinicProfile.create({ data: { userId: foreignClinicAdmin.id, name: 'Clínica ajena', address: 'Quito', verificationStatus: 'APPROVED' } });
    await prisma.doctorClinicWorkplace.create({ data: { doctorProfileId: doctor.id, clinicProfileId: clinic.id } });
    const doctorToken = generateToken({ id: doctorUser.id, role: 'DOCTOR' });
    const createAndSubmit = async (title: string) => {
      const created = await request(app).post('/api/doctors/me/certifications').set('Authorization', `Bearer ${doctorToken}`).field('title', title).field('institution', 'Universidad').field('issuedAt', '2021-05-01').attach('document', validPdf, { filename: 'documento.pdf', contentType: 'application/pdf' }).expect(201);
      await request(app).post(`/api/doctors/me/certifications/${created.body.id}/submit`).set('Authorization', `Bearer ${doctorToken}`).expect(200);
      return created.body.id as string;
    };
    const approvedId = await createAndSubmit('Certificación aprobada');
    const rejectedId = await createAndSubmit('Certificación rechazada');

    await request(app).get('/api/admin/certifications').set('Authorization', `Bearer ${generateToken({ id: patient.id, role: 'PATIENT' })}`).expect(403);
    await request(app).patch(`/api/admin/certifications/${approvedId}/review`).set('Authorization', `Bearer ${doctorToken}`).send({ action: 'APPROVE' }).expect(403);
    const foreignList = await request(app).get('/api/admin/certifications').set('Authorization', `Bearer ${generateToken({ id: foreignClinicAdmin.id, role: 'CLINIC_ADMIN' })}`).expect(200);
    expect(foreignList.body.items).toEqual([]);
    await request(app).patch(`/api/admin/certifications/${approvedId}/review`).set('Authorization', `Bearer ${generateToken({ id: foreignClinicAdmin.id, role: 'CLINIC_ADMIN' })}`).send({ action: 'APPROVE' }).expect(404);

    const clinicToken = generateToken({ id: clinicAdmin.id, role: 'CLINIC_ADMIN' });
    const document = await request(app).get(`/api/admin/certifications/${approvedId}/document`).set('Authorization', `Bearer ${clinicToken}`).expect(200);
    expect(document.body).toMatchObject({ expiresInSeconds: 300 });
    expect(document.body.url).toContain('signature=');
    expect(document.body.url).toContain('expires_at=');
    const approved = await request(app).patch(`/api/admin/certifications/${approvedId}/review`).set('Authorization', `Bearer ${clinicToken}`).send({ action: 'APPROVE' }).expect(200);
    expect(approved.body.status).toBe('APPROVED');

    const superToken = generateToken({ id: superAdmin.id, role: 'SUPER_ADMIN' });
    const rejected = await request(app).patch(`/api/admin/certifications/${rejectedId}/review`).set('Authorization', `Bearer ${superToken}`).send({ action: 'REJECT', reason: 'Documento ilegible' }).expect(200);
    expect(rejected.body).toMatchObject({ status: 'REJECTED', rejectionReason: 'Documento ilegible' });
    expect(await prisma.certificationAuditLog.count({ where: { certificationId: approvedId, action: 'APPROVED', actorUserId: clinicAdmin.id } })).toBe(1);
    expect(await prisma.certificationAuditLog.count({ where: { certificationId: rejectedId, action: 'REJECTED', reason: 'Documento ilegible' } })).toBe(1);

    const publicProfile = await request(app).get(`/api/doctors/${doctor.id}`).expect(200);
    expect(publicProfile.body.certifications).toEqual([expect.objectContaining({ id: approvedId, title: 'Certificación aprobada', status: 'APPROVED' })]);
    expect(JSON.stringify(publicProfile.body)).not.toMatch(/documentUrl|documentPublicId|authenticated|Documento ilegible/);
    await request(app).patch(`/api/doctors/me/certifications/${approvedId}`).set('Authorization', `Bearer ${doctorToken}`).field('title', 'Cambiar aprobada').expect(409);
  });

  it('elimina lógicamente un borrador y conserva su auditoría', async () => {
    const doctorUser = await user('delete-cert-doctor@zenda.test', 'DOCTOR');
    await prisma.doctorProfile.create({ data: { userId: doctorUser.id, licenseNumber: 'CERT-DELETE', consultationPrice: 40 } });
    const token = generateToken({ id: doctorUser.id, role: 'DOCTOR' });
    const created = await request(app).post('/api/doctors/me/certifications').set('Authorization', `Bearer ${token}`).field('title', 'Borrador eliminable').field('institution', 'Universidad').attach('document', validPdf, { filename: 'documento.pdf', contentType: 'application/pdf' }).expect(201);
    await request(app).delete(`/api/doctors/me/certifications/${created.body.id}`).set('Authorization', `Bearer ${token}`).expect(204);
    const stored = await prisma.certification.findUniqueOrThrow({ where: { id: created.body.id } });
    expect(stored.deletedAt).not.toBeNull();
    expect(await prisma.certificationAuditLog.findMany({ where: { certificationId: stored.id }, orderBy: { createdAt: 'asc' }, select: { action: true } })).toEqual([{ action: 'CREATED' }, { action: 'DELETED' }]);
    const list = await request(app).get('/api/doctors/me/certifications').set('Authorization', `Bearer ${token}`).expect(200);
    expect(list.body.items).toEqual([]);
  });
});
