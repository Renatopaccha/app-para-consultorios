import {
  ONBOARDING_ACCESS_TTL_SECONDS,
  ONBOARDING_IMAGE_MAX_BYTES,
  setOnboardingStorageAdaptersForTests,
  temporaryOnboardingFileUrl,
  uploadOnboardingCredentialDocument,
  uploadOnboardingImage,
} from './professionalOnboardingStorage.service';

function png(width = 10, height = 10) {
  const buffer = Buffer.alloc(24);
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(buffer);
  buffer.write('IHDR', 12, 'ascii'); buffer.writeUInt32BE(width, 16); buffer.writeUInt32BE(height, 20);
  return buffer;
}
const pdf = Buffer.from('%PDF-1.4\n1 0 obj\n<< /Type /Page >>\nendobj\n%%EOF', 'ascii');

describe('professional onboarding private storage', () => {
  const upload = jest.fn(async (_buffer, options) => ({ publicId: `${options.folder}/${options.public_id}`, format: 'png' }));
  beforeEach(() => {
    upload.mockClear();
    setOnboardingStorageAdaptersForTests({ upload, access: (publicId, format, options) => `https://temporary.test/${publicId}.${format}?expires=${options.expires_at}` });
  });
  afterAll(() => setOnboardingStorageAdaptersForTests());

  it('controla folder/publicId, privacidad y checksum desde bytes del backend', async () => {
    const stored = await uploadOnboardingImage(png(), 'image/png', 'application-uuid', 'AVATAR');
    const options = upload.mock.calls[0]![1];
    expect(options).toMatchObject({ folder: 'zenda/professional-onboarding/applications/application-uuid/avatar', resource_type: 'image', type: 'authenticated', overwrite: false });
    expect(options.public_id).toMatch(/^asset-[0-9a-f-]+$/);
    expect(stored.checksumSha256).toMatch(/^[0-9a-f]{64}$/);
    expect(JSON.stringify(options)).not.toMatch(/email|clerk|cedula/i);
  });

  it('rechaza SVG, MIME falso y exceso de 5 MB antes de upload', async () => {
    await expect(uploadOnboardingImage(Buffer.from('<svg/>'), 'image/svg+xml', 'app', 'AVATAR')).rejects.toMatchObject({ code: 'UNSUPPORTED_IMAGE' });
    await expect(uploadOnboardingImage(png(), 'image/jpeg', 'app', 'AVATAR')).rejects.toMatchObject({ code: 'FILE_CONTENT_TYPE_MISMATCH' });
    await expect(uploadOnboardingImage(Buffer.alloc(ONBOARDING_IMAGE_MAX_BYTES + 1), 'image/png', 'app', 'AVATAR')).rejects.toMatchObject({ code: 'UPLOAD_TOO_LARGE', status: 413 });
    expect(upload).not.toHaveBeenCalled();
  });

  it('conserva documentos authenticated, PII-free y con SHA-256 real', async () => {
    const stored = await uploadOnboardingCredentialDocument(pdf, 'application/pdf', 'app-uuid', 'credential-uuid');
    expect(upload.mock.calls[0]![1]).toMatchObject({ folder: 'zenda/professional-onboarding/applications/app-uuid/credentials/credential-uuid', resource_type: 'raw', type: 'authenticated' });
    expect(stored).toMatchObject({ mimeType: 'application/pdf', format: 'pdf', resourceType: 'raw', pageCount: 1 });
    expect(stored.checksumSha256).toMatch(/^[0-9a-f]{64}$/);
  });

  it('genera acceso temporal de cinco minutos sin URL persistente almacenada', () => {
    const now = Date.UTC(2026, 7, 13, 12, 0, 0);
    const access = temporaryOnboardingFileUrl({ publicId: 'private-id', format: 'png', resourceType: 'image' }, now);
    expect(access.expiresInSeconds).toBe(ONBOARDING_ACCESS_TTL_SECONDS);
    expect(access.expiresAt).toBe('2026-08-13T12:05:00.000Z');
    expect(access.url).toContain(`expires=${Math.floor(now / 1000) + 300}`);
  });
});
