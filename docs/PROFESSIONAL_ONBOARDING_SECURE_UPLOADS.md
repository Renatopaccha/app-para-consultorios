# Professional onboarding secure uploads

## Auditoría y estrategia

Zenda ya utilizaba Cloudinary mediante upload proxy desde Express: `multer.memoryStorage`, `upload_stream`, UUID generado por backend y validación binaria para JPEG, PNG, WebP y PDF. Las certificaciones operativas ya usan delivery `authenticated`, acceso firmado de 300 segundos y adapters para evitar red real en tests. Las fotos de perfil legacy son públicas y no constituyen un patrón de privacidad válido para onboarding.

No se encontraron upload presets, unsigned uploads ni signed direct uploads. Se escogió **backend proxy** porque permite calcular SHA-256 sobre los bytes recibidos, comprobar magic bytes y dimensiones antes de Cloudinary y mantener folder/public ID fuera del control del navegador. El secreto Cloudinary permanece exclusivamente en backend.

La configuración anterior se ejecutaba al importar `image.service`, antes de que `app.ts` cargara `.env`, y `certificationDocument.service` dependía indirectamente de ese side effect. Se centralizó en una configuración lazy que valida las tres variables existentes: `CLOUDINARY_CLOUD_NAME`, `CLOUDINARY_API_KEY` y `CLOUDINARY_API_SECRET`.

## Privacidad y paths

Avatar, interiores y exteriores se almacenan como imágenes Cloudinary `authenticated` durante todo el onboarding. Los documentos de credenciales también son siempre `authenticated`; PDF usa `resource_type=raw` y las imágenes usan `resource_type=image`.

Los paths son determinados por backend:

```text
zenda/professional-onboarding/applications/<application UUID>/avatar/asset-<UUID>
zenda/professional-onboarding/applications/<application UUID>/practice-interior/asset-<UUID>
zenda/professional-onboarding/applications/<application UUID>/practice-exterior/asset-<UUID>
zenda/professional-onboarding/applications/<application UUID>/credentials/<credential UUID>/document-<UUID>
```

No contienen email, nombre, Clerk ID, documento regulatorio ni número de credencial. `folder`, `publicId`, transformaciones, delivery type y access control enviados por cliente se ignoran.

## Contratos

Los uploads son `multipart/form-data`, campo binario `file`:

- `POST /api/professional-onboarding/assets`: `category`, `expectedRevision`, `sortOrder?`.
- `PUT /api/professional-onboarding/assets/order`: JSON `expectedRevision`, `items[{assetId, sortOrder}]`.
- `GET /api/professional-onboarding/assets/:assetId/access`.
- `DELETE /api/professional-onboarding/assets/:assetId`: JSON `expectedRevision`.
- `POST /api/professional-onboarding/credentials/:credentialId/documents`: `kind?`, `expectedRevision`.
- `GET /api/professional-onboarding/credentials/:credentialId/documents/:documentId/access`.
- `DELETE /api/professional-onboarding/credentials/:credentialId/documents/:documentId`: JSON `expectedRevision`.

Todos requieren `authenticate` y ownership por `req.user.id`; ninguno requiere rol DOCTOR ni ProfessionalAccess. Sólo `DRAFT` y `NEEDS_CHANGES` permiten mutaciones. El propietario puede generar acceso temporal en estados read-only, incluido `PENDING_REVIEW`.

## Validación y lifecycle

- Imágenes: JPEG, PNG o WebP, máximo 5 MB, dimensiones máximas 8000×8000 y 32 megapíxeles. HEIC/HEIF y SVG quedan excluidos.
- Documentos: PDF, JPEG, PNG o WebP, máximo 8 MB. No se admiten HTML, SVG, ejecutables, archivos comprimidos ni Office.
- La validación usa contenido real; no sólo nombre, extensión o MIME declarado.
- `checksumSha256` se calcula en backend sobre los bytes recibidos. Nunca se acepta un checksum del navegador.
- Documentos se crean con `scanStatus=PENDING` y `scannedAt=NULL`. No se afirma que estén limpios sin una integración antivirus real.
- El schema permite múltiples interiores y múltiples exteriores; no existe restricción aprobada para un único exterior, por lo que esta fase no inventa esa regla.
- Cada cambio material incrementa `ProfessionalApplication.currentRevision` y exige `expectedRevision`.
- El avatar nuevo se sube primero; luego una transacción soft-deletea el anterior y registra el nuevo. Sólo tras commit se intenta borrar físicamente el anterior.
- Delete primero confirma soft-delete y revisión en DB; después realiza cleanup Cloudinary best-effort. Un fallo externo no deja un registro activo apuntando a un archivo ya destruido.

Los accesos firmados expiran en 300 segundos y nunca se persisten. Las respuestas y snapshots contienen sólo metadata semántica: IDs internos, categoría/kind, MIME, tamaño, dimensiones/páginas, checksum, orden y estados. Excluyen `publicId`, provider, URLs, firmas y secretos.

## Cleanup y límites conocidos

El proxy evita uploads preparados sin commit. Si Cloudinary acepta un upload y falla la transacción DB, se intenta destruir inmediatamente el nuevo recurso. Los fallos de cleanup siguen siendo posibles y se convierten en huérfanos privados; no existe actualmente un outbox de archivos. Una fase futura debe reconciliar el prefijo de onboarding y borrar recursos sin fila activa después de un TTL prudente.

No hay antivirus integrado. Los documentos `PENDING` sólo son accesibles por URL corta y ownership; una futura revisión administrativa debe tener autorización separada y debería bloquear decisiones que requieran evidencia hasta completar scanning.

Los uploads tienen límite por usuario autenticado de 40 operaciones cada 15 minutos (1000 en tests), además de un archivo por request y límites de tamaño de Multer.
