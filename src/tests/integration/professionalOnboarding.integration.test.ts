import request from 'supertest';
import app from '../../app';
import prisma, { disconnectPrisma } from '../../prisma';
import { hashSnapshotPayload } from '../../services/professionalOnboarding.service';
import { generateToken } from '../../utils/jwt';
import { assertIntegrationDatabase, clearIntegrationDatabase } from './testDatabase';

let sequence = 0;

async function userFixture(label: string, role: 'PATIENT' | 'DOCTOR' = 'PATIENT') {
  sequence += 1;
  const email = `${label}.${sequence}@onboarding.zenda.test`;
  const user = await prisma.user.create({ data: { email, emailNormalized: email, firstName: 'Onboarding', lastName: label, role } });
  return { user, token: generateToken({ id: user.id, role }) };
}

const auth = (token: string) => ({ Authorization: `Bearer ${token}` });

async function catalogs() {
  const profession = await prisma.healthProfession.create({ data: { code: `MED_${sequence}`, name: `Medicina ${sequence}`, nameNormalized: `medicina ${sequence}` } });
  const otherProfession = await prisma.healthProfession.create({ data: { code: `DEN_${sequence}`, name: `Odontología ${sequence}`, nameNormalized: `odontologia ${sequence}` } });
  const [specialty, otherSpecialty, spanish, english] = await Promise.all([
    prisma.specialty.create({ data: { healthProfessionId: profession.id, code: `CARD_${sequence}`, name: `Cardiología ${sequence}`, nameNormalized: `cardiologia ${sequence}` } }),
    prisma.specialty.create({ data: { healthProfessionId: otherProfession.id, code: `ORT_${sequence}`, name: `Ortodoncia ${sequence}`, nameNormalized: `ortodoncia ${sequence}` } }),
    prisma.language.create({ data: { code: `es-${sequence}`, name: `Español ${sequence}`, nameNormalized: `espanol ${sequence}` } }),
    prisma.language.create({ data: { code: `en-${sequence}`, name: `Inglés ${sequence}`, nameNormalized: `ingles ${sequence}` } }),
  ]);
  return { profession, otherProfession, specialty, otherSpecialty, spanish, english };
}

describe('professional onboarding HTTP', () => {
  beforeAll(() => assertIntegrationDatabase());
  beforeEach(async () => clearIntegrationDatabase());
  afterAll(async () => {
    await clearIntegrationDatabase();
    await disconnectPrisma();
  });

  it('bootstrap NOT_STARTED y start idempotente funcionan para PATIENT sin capacidad DOCTOR', async () => {
    const actor = await userFixture('start');
    await request(app).get('/api/professional-onboarding').set(auth(actor.token)).expect(200)
      .expect(({ body }) => expect(body).toMatchObject({ state: 'NOT_STARTED', applicationId: null, access: { professionalAccessStatus: null } }));

    const [first, second] = await Promise.all([
      request(app).post('/api/professional-onboarding/start').set(auth(actor.token)).expect(200),
      request(app).post('/api/professional-onboarding/start').set(auth(actor.token)).expect(200),
    ]);
    expect([first.body.created, second.body.created].sort()).toEqual([false, true]);
    expect(first.body.application).toMatchObject({ status: 'DRAFT', cycleNumber: 1, currentRevision: 1 });
    expect(second.body.application.id).toBe(first.body.application.id);
    expect(await prisma.professionalApplication.count({ where: { userId: actor.user.id } })).toBe(1);
    expect(await prisma.doctorProfile.count({ where: { userId: actor.user.id } })).toBe(0);
    expect(await prisma.professionalAccess.count({ where: { userId: actor.user.id } })).toBe(0);
    expect(await prisma.userRoleAssignment.count({ where: { userId: actor.user.id, role: 'DOCTOR' } })).toBe(0);
  });

  it('expone sólo catálogos activos y filtra especialidades por profesión', async () => {
    const actor = await userFixture('catalog');
    const c = await catalogs();
    await prisma.language.update({ where: { id: c.english.id }, data: { isActive: false } });
    const professions = await request(app).get('/api/professional-onboarding/catalog/professions').set(auth(actor.token)).expect(200);
    const specialties = await request(app).get('/api/professional-onboarding/catalog/specialties').query({ healthProfessionId: c.profession.id }).set(auth(actor.token)).expect(200);
    const languages = await request(app).get('/api/professional-onboarding/catalog/languages').set(auth(actor.token)).expect(200);
    expect(professions.body.items.map((item: { id: string }) => item.id)).toEqual(expect.arrayContaining([c.profession.id, c.otherProfession.id]));
    expect(specialties.body.items.map((item: { id: string }) => item.id)).toEqual([c.specialty.id]);
    expect(languages.body.items.map((item: { id: string }) => item.id)).toEqual([c.spanish.id]);
  });

  it('autosave parcial aplica ownership, profesión, specialties, primary e optimistic concurrency', async () => {
    const [owner, outsider] = await Promise.all([userFixture('owner'), userFixture('outsider')]);
    const c = await catalogs();
    await request(app).post('/api/professional-onboarding/start').set(auth(owner.token)).expect(200);

    const saved = await request(app).patch('/api/professional-onboarding/identity').set(auth(owner.token)).send({
      expectedRevision: 1, legalGivenNames: ' Ana ', healthProfessionId: c.profession.id, lastVisitedStep: 1,
    }).expect(200);
    expect(saved.body).toMatchObject({ legalGivenNames: 'Ana', currentRevision: 2 });
    await request(app).patch('/api/professional-onboarding/identity').set(auth(owner.token)).send({ expectedRevision: 1, legalFamilyNames: 'Viejo' }).expect(409)
      .expect(({ body }) => expect(body.code).toBe('PROFESSIONAL_APPLICATION_CONFLICT'));
    await request(app).patch('/api/professional-onboarding/identity').set(auth(owner.token)).send({ expectedRevision: 2, healthProfessionId: 'not-an-active-profession' }).expect(422)
      .expect(({ body }) => expect(body.code).toBe('PROFESSIONAL_ONBOARDING_INPUT_INVALID'));
    await request(app).put('/api/professional-onboarding/specialties').set(auth(owner.token)).send({ expectedRevision: 2, specialties: [{ specialtyId: c.otherSpecialty.id }] }).expect(422)
      .expect(({ body }) => expect(body.code).toBe('PROFESSIONAL_SPECIALTY_PROFESSION_MISMATCH'));
    const secondSpecialty = await prisma.specialty.create({ data: { healthProfessionId: c.profession.id, code: `GEN_${sequence}`, name: `General ${sequence}`, nameNormalized: `general ${sequence}` } });
    const specialties = await request(app).put('/api/professional-onboarding/specialties').set(auth(owner.token)).send({ expectedRevision: 2, specialties: [{ specialtyId: c.specialty.id, isPrimary: true }, { specialtyId: secondSpecialty.id }] }).expect(200);
    expect(specialties.body).toMatchObject({ currentRevision: 3 });
    expect(specialties.body.specialties).toHaveLength(2);
    expect(specialties.body.specialties.filter((item: { isPrimary: boolean }) => item.isPrimary)).toHaveLength(1);

    await request(app).patch('/api/professional-onboarding/identity').set(auth(outsider.token)).send({ expectedRevision: 3, legalGivenNames: 'Intruso' }).expect(404);
    expect(await prisma.professionalApplication.findFirstOrThrow({ where: { userId: owner.user.id } })).toMatchObject({ legalGivenNames: 'Ana' });
  });

  it('gestiona credenciales propias con institución manual y rechaza una credencial ajena', async () => {
    const [owner, outsider] = await Promise.all([userFixture('credential-owner'), userFixture('credential-outsider')]);
    await request(app).post('/api/professional-onboarding/start').set(auth(owner.token)).expect(200);
    await request(app).post('/api/professional-onboarding/start').set(auth(outsider.token)).expect(200);
    const created = await request(app).post('/api/professional-onboarding/credentials').set(auth(owner.token)).send({
      expectedRevision: 1, credentialType: 'PRIMARY_DEGREE', countryCode: 'ec', exactTitle: 'Médico',
      institutionNameSnapshot: 'Universidad manual', isPrimary: true, sortOrder: 0, lastVisitedStep: 2,
    }).expect(201);
    expect(created.body).toMatchObject({ currentRevision: 2, credentials: [{ institutionId: null, institutionNameSnapshot: 'Universidad manual', isPrimary: true }] });
    const credentialId = created.body.credentials[0].id;
    await request(app).put(`/api/professional-onboarding/credentials/${credentialId}`).set(auth(outsider.token)).send({
      expectedRevision: 1, credentialType: 'PRIMARY_DEGREE', countryCode: 'EC', exactTitle: 'Ajeno', institutionNameSnapshot: 'Ajena',
    }).expect(404).expect(({ body }) => expect(body.code).toBe('PROFESSIONAL_CREDENTIAL_OWNERSHIP_MISMATCH'));
    expect(await prisma.professionalCredential.findUniqueOrThrow({ where: { id: credentialId } })).toMatchObject({ userId: owner.user.id, exactTitle: 'Médico' });

    const updated = await request(app).put(`/api/professional-onboarding/credentials/${credentialId}`).set(auth(owner.token)).send({
      expectedRevision: 2, credentialType: 'PRIMARY_DEGREE', countryCode: 'EC', exactTitle: 'Médico cirujano', institutionNameSnapshot: 'Universidad manual', isPrimary: true,
    }).expect(200);
    expect(updated.body).toMatchObject({ currentRevision: 3, credentials: [{ exactTitle: 'Médico cirujano' }] });
    await request(app).delete(`/api/professional-onboarding/credentials/${credentialId}`).set(auth(owner.token)).send({ expectedRevision: 3 }).expect(200)
      .expect(({ body }) => expect(body.credentials).toEqual([]));
    expect((await prisma.professionalCredential.findUniqueOrThrow({ where: { id: credentialId } })).deletedAt).not.toBeNull();
  });

  it('guarda location parcial con floorNumber=0 e idiomas sin default implícito', async () => {
    const actor = await userFixture('profile');
    const c = await catalogs();
    await request(app).post('/api/professional-onboarding/start').set(auth(actor.token)).expect(200);
    const location = await request(app).put('/api/professional-onboarding/location').set(auth(actor.token)).send({ expectedRevision: 1, city: 'Quito', floorNumber: 0, lastVisitedStep: 3 }).expect(200);
    expect(location.body).toMatchObject({ currentRevision: 2, location: { city: 'Quito', floorNumber: 0 } });
    expect(location.body.location.countryCode).toBeNull();
    const profile = await request(app).put('/api/professional-onboarding/profile').set(auth(actor.token)).send({
      expectedRevision: 2, publicBio: 'Perfil público', languages: [{ languageId: c.spanish.id }, { languageId: c.english.id, proficiency: 'C1' }], lastVisitedStep: 4,
    }).expect(200);
    expect(profile.body.languages).toHaveLength(2);
    expect(profile.body.currentRevision).toBe(3);
  });

  it('rechaza submit incompleto y procesa submit válido de forma transaccional e idempotente', async () => {
    const actor = await userFixture('submit');
    const c = await catalogs();
    await request(app).post('/api/professional-onboarding/start').set(auth(actor.token)).expect(200);
    await request(app).post('/api/professional-onboarding/submit').set(auth(actor.token)).set('Idempotency-Key', 'incomplete-1').send({ expectedRevision: 1 }).expect(422)
      .expect(({ body }) => expect(body).toMatchObject({ code: 'PROFESSIONAL_APPLICATION_VALIDATION_FAILED', details: { fields: expect.arrayContaining(['legalGivenNames', 'location.city']) } }));
    expect(await prisma.professionalApplicationSnapshot.count()).toBe(0);

    const identity = await request(app).patch('/api/professional-onboarding/identity').set(auth(actor.token)).send({
      expectedRevision: 1, legalGivenNames: 'Ana', legalFamilyNames: 'Pérez', primaryPhoneE164: '+593999999999', practiceCountryCode: 'EC', healthProfessionId: c.profession.id,
    }).expect(200);
    const location = await request(app).put('/api/professional-onboarding/location').set(auth(actor.token)).send({
      expectedRevision: identity.body.currentRevision, countryCode: 'EC', city: 'Quito', street1: 'Av. Principal', floorNumber: 0,
    }).expect(200);
    const first = await request(app).post('/api/professional-onboarding/submit').set(auth(actor.token)).set('Idempotency-Key', 'submit-valid-1').send({ expectedRevision: location.body.currentRevision }).expect(200);
    const retry = await request(app).post('/api/professional-onboarding/submit').set(auth(actor.token)).set('Idempotency-Key', 'submit-valid-1').send({ expectedRevision: location.body.currentRevision }).expect(200);
    expect(first.body).toMatchObject({ idempotent: false, application: { status: 'PENDING_REVIEW' } });
    expect(retry.body).toMatchObject({ idempotent: true, snapshot: { id: first.body.snapshot.id } });
    expect(await prisma.professionalApplicationSnapshot.count()).toBe(1);
    expect(await prisma.professionalApplicationReviewLog.count()).toBe(1);
    const snapshot = await prisma.professionalApplicationSnapshot.findFirstOrThrow();
    expect(snapshot.payloadHash).toBe(hashSnapshotPayload(snapshot.payload));
    expect(await prisma.professionalAccess.count()).toBe(0);
    expect(await prisma.doctorProfile.count()).toBe(0);
    expect(await prisma.userRoleAssignment.count({ where: { role: 'DOCTOR' } })).toBe(0);
    await request(app).post('/api/professional-onboarding/submit').set(auth(actor.token)).set('Idempotency-Key', 'valid-1').send({ expectedRevision: location.body.currentRevision }).expect(409)
      .expect(({ body }) => expect(body.code).toBe('PROFESSIONAL_APPLICATION_ALREADY_PENDING'));

    await request(app).put('/api/professional-onboarding/location').set(auth(actor.token)).send({ expectedRevision: first.body.application.currentRevision, city: 'Cuenca' }).expect(409)
      .expect(({ body }) => expect(body.code).toBe('PROFESSIONAL_APPLICATION_ALREADY_PENDING'));
    await request(app).get('/api/auth/me').set(auth(actor.token)).expect(200);
  });

  it('NEEDS_CHANGES vuelve a ser editable y un DOCTOR pending sigue bloqueado en enforce', async () => {
    const actor = await userFixture('needs-changes');
    const application = await prisma.professionalApplication.create({ data: { userId: actor.user.id, cycleNumber: 1, status: 'NEEDS_CHANGES', submittedAt: new Date() } });
    await request(app).patch('/api/professional-onboarding/identity').set(auth(actor.token)).send({ expectedRevision: application.currentRevision, legalGivenNames: 'Corregido' }).expect(200);

    const pendingDoctor = await userFixture('pending-doctor', 'DOCTOR');
    await prisma.professionalApplication.create({ data: { userId: pendingDoctor.user.id, cycleNumber: 1, status: 'PENDING_REVIEW', submittedAt: new Date() } });
    const previousMode = process.env.PROFESSIONAL_AUTH_ENFORCEMENT_MODE;
    process.env.PROFESSIONAL_AUTH_ENFORCEMENT_MODE = 'enforce';
    await request(app).get('/api/doctors/me/profile').set(auth(pendingDoctor.token)).expect(403)
      .expect(({ body }) => expect(body.code).toBe('PROFESSIONAL_ACCESS_REQUIRED'));
    if (previousMode) process.env.PROFESSIONAL_AUTH_ENFORCEMENT_MODE = previousMode;
    else delete process.env.PROFESSIONAL_AUTH_ENFORCEMENT_MODE;
  });
});
