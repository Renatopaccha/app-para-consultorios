import { CERTIFICATION_MAX_BYTES, CertificationDocumentError, inspectCertificationDocument } from './certificationDocument.service';

const validPdf = Buffer.from('%PDF-1.4\n1 0 obj\n<< /Type /Page >>\nendobj\n%%EOF', 'ascii');

describe('validación binaria de documentos profesionales', () => {
  it('acepta un PDF real dentro del límite', () => {
    expect(inspectCertificationDocument(validPdf, 'application/pdf')).toEqual({ mimeType: 'application/pdf', format: 'pdf', resourceType: 'raw' });
  });

  it('rechaza MIME falso y contenido arbitrario', () => {
    expect(() => inspectCertificationDocument(validPdf, 'image/png')).toThrow(CertificationDocumentError);
    expect(() => inspectCertificationDocument(Buffer.from('<html>malicioso</html>'), 'application/pdf')).toThrow(CertificationDocumentError);
  });

  it('rechaza archivo vacío y tamaño excesivo', () => {
    expect(() => inspectCertificationDocument(Buffer.alloc(0), 'application/pdf')).toThrow('vacío');
    expect(() => inspectCertificationDocument(Buffer.alloc(CERTIFICATION_MAX_BYTES + 1), 'application/pdf')).toThrow('8 MB');
  });
});
