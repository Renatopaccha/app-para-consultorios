import { cloudinaryTransformedUrl, ImageValidationError, inspectImage, profileImageUrls } from './image.service';

function png(width: number, height: number) {
  const buffer = Buffer.alloc(24);
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(buffer, 0);
  buffer.write('IHDR', 12, 'ascii');
  buffer.writeUInt32BE(width, 16); buffer.writeUInt32BE(height, 20);
  return buffer;
}

describe('seguridad y variantes de imágenes', () => {
  it('detecta el contenido PNG real y sus dimensiones', () => {
    expect(inspectImage(png(600, 400))).toEqual({ mime: 'image/png', width: 600, height: 400 });
  });

  it('rechaza contenido falso, vacío y dimensiones excesivas', () => {
    expect(() => inspectImage(Buffer.from('no es una imagen'))).toThrow(ImageValidationError);
    expect(() => inspectImage(Buffer.alloc(0))).toThrow('vacía');
    expect(() => inspectImage(png(8_001, 100))).toThrow('dimensiones');
  });

  it('deriva avatar y perfil desde un único asset Cloudinary seguro', () => {
    const original = 'https://res.cloudinary.com/zenda/image/upload/v1/doctors/avatar.webp';
    const urls = profileImageUrls(original)!;
    expect(urls.original).toBe(original);
    expect(urls.avatar).toContain('/image/upload/c_fill,g_auto,w_96,h_96,q_auto,f_auto/');
    expect(urls.profile).toContain('/image/upload/c_fill,g_auto,w_600,h_600,q_auto,f_auto/');
    expect(cloudinaryTransformedUrl('https://example.com/image.png', 'w_96')).toBe('https://example.com/image.png');
  });
});
