import request from 'supertest';
import app from '../../app';
import prisma, { disconnectPrisma } from '../../prisma';
import { generateToken } from '../../utils/jwt';
import { setProfileImageUploadAdapterForTests } from '../../services/image.service';
import { assertIntegrationDatabase, clearIntegrationDatabase } from './testDatabase';

function png(width = 600, height = 600) {
  const buffer = Buffer.alloc(24);
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(buffer);
  buffer.write('IHDR', 12, 'ascii'); buffer.writeUInt32BE(width, 16); buffer.writeUInt32BE(height, 20);
  return buffer;
}

async function doctor(email: string, licenseNumber: string) {
  const user = await prisma.user.create({ data: { email, emailNormalized: email, firstName: 'Ana', lastName: 'Torres', passwordHash: 'x', role: 'DOCTOR' } });
  const profile = await prisma.doctorProfile.create({ data: { userId: user.id, licenseNumber, consultationPrice: 50 } });
  return { user, profile, token: generateToken({ id: user.id, role: 'DOCTOR' }) };
}

describe('perfil profesional y fotografía con PostgreSQL real', () => {
  beforeEach(async () => {
    assertIntegrationDatabase(); await clearIntegrationDatabase();
    setProfileImageUploadAdapterForTests(async () => ({ secureUrl: 'https://res.cloudinary.com/zenda/image/upload/v42/zenda/doctors/avatar.webp', publicId: 'zenda/doctors/avatar' }));
  });
  afterAll(async () => { setProfileImageUploadAdapterForTests(undefined); await clearIntegrationDatabase(); await disconnectPrisma(); });

  it('actualiza solo la foto propia y devuelve variantes optimizadas', async () => {
    const actor = await doctor('photo@zenda.test', 'PHOTO-1');
    const other = await doctor('other-photo@zenda.test', 'PHOTO-2');
    const response = await request(app).post('/api/profile/doctor/photo').set('Authorization', `Bearer ${actor.token}`)
      .attach('image', png(), { filename: 'avatar.png', contentType: 'image/png' }).expect(200);
    expect(response.body.profileImageUrls.avatar).toContain('w_96,h_96');
    expect(response.body.profileImageUrls.profile).toContain('w_600,h_600');
    expect((await prisma.doctorProfile.findUniqueOrThrow({ where: { id: actor.profile.id } })).profileImageUrl).toBe(response.body.profileImageUrl);
    expect((await prisma.doctorProfile.findUniqueOrThrow({ where: { id: other.profile.id } })).profileImageUrl).toBeNull();
  });

  it('rechaza MIME falso y tamaño superior a 10 MB', async () => {
    const actor = await doctor('invalid-photo@zenda.test', 'PHOTO-3');
    await request(app).post('/api/profile/doctor/photo').set('Authorization', `Bearer ${actor.token}`)
      .attach('image', Buffer.from('contenido ejecutable'), { filename: 'fake.png', contentType: 'image/png' }).expect(422);
    await request(app).post('/api/profile/doctor/photo').set('Authorization', `Bearer ${actor.token}`)
      .attach('image', Buffer.alloc(10 * 1024 * 1024 + 1), { filename: 'large.png', contentType: 'image/png' }).expect(413);
    expect((await prisma.doctorProfile.findUniqueOrThrow({ where: { id: actor.profile.id } })).profileImageUrl).toBeNull();
  });

  it('acepta identidad controlada y rechaza un título arbitrario inseguro', async () => {
    const actor = await doctor('title@zenda.test', 'TITLE-1');
    const valid = await request(app).patch('/api/doctors/me/profile').set('Authorization', `Bearer ${actor.token}`)
      .send({ professionCode: 'PSYCHOLOGY', displayTitle: 'PSYCHOLOGIST_FEMALE', customDisplayTitle: null }).expect(200);
    expect(valid.body).toMatchObject({ professionCode: 'PSYCHOLOGY', displayTitle: 'PSYCHOLOGIST_FEMALE', publicDisplayName: 'Psicóloga Ana Torres' });
    await request(app).patch('/api/doctors/me/profile').set('Authorization', `Bearer ${actor.token}`)
      .send({ displayTitle: 'OTHER', customDisplayTitle: '<script>alert(1)</script>' }).expect(422);
    expect(await prisma.doctorProfile.findUniqueOrThrow({ where: { id: actor.profile.id } })).toMatchObject({ displayTitle: 'PSYCHOLOGIST_FEMALE', customDisplayTitle: null });
  });
});
