# Professional onboarding backend

Esta fase permite que cualquier `User` autenticado inicie y envíe una solicitud profesional sin `User.role=DOCTOR`, `DoctorProfile`, `ProfessionalAccess` ni `UserRoleAssignment`. Todas las rutas usan `authenticate` y resuelven ownership exclusivamente desde `req.user.id`.

## Estado y edición

- `DRAFT` y `NEEDS_CHANGES`: editables.
- `PENDING_REVIEW`: sólo lectura; autosave responde conflicto.
- `APPROVED` y `REJECTED`: terminales.
- La reaplicación después de un estado terminal no está habilitada en esta fase.
- Cada mutación exige `expectedRevision`; una revisión obsoleta responde `PROFESSIONAL_APPLICATION_CONFLICT`.
- `lastVisitedStep` admite valores `1..5`. Es metadata de reanudación, no determina validez del aggregate.

## Política mínima de submit, versión 1

La arquitectura existente no define todavía una política versionada que haga obligatorios especialidades, credenciales o idiomas. Por ello no se inventan requisitos regulatorios: el submit exige nombres legales, teléfono E.164, país de práctica, profesión activa y una ubicación con país, ciudad y calle principal. `HealthProfession.requiresSpecialty` se expone al cliente, pero no se activa como requisito hasta aprobar una política de negocio explícita. Del mismo modo, `credentialPolicyVersion` no expresa por sí solo si una credencial o un idioma son obligatorios.

El submit requiere `Idempotency-Key`, bloquea el aggregate, valida el estado completo, genera un snapshot canónico SHA-256, incrementa la revisión, cambia a `PENDING_REVIEW` y crea el log `SUBMITTED` o `RESUBMITTED` en una sola transacción. Un retry con la misma clave devuelve el resultado existente sin duplicar snapshot.

El snapshot excluye tokens, URLs firmadas, binarios, identificadores específicos del storage y `ProfessionalRegulatoryIdentity`. Cuando existen uploads, incluye sólo metadata semántica segura de assets y documentos. Esta fase no escribe identidades regulatorias.

## Endpoints

- `GET /api/professional-onboarding`
- `POST /api/professional-onboarding/start`
- `GET /api/professional-onboarding/catalog/professions`
- `GET /api/professional-onboarding/catalog/specialties?healthProfessionId=...`
- `GET /api/professional-onboarding/catalog/languages`
- `PATCH /api/professional-onboarding/identity`
- `PUT /api/professional-onboarding/specialties`
- `POST /api/professional-onboarding/credentials`
- `PUT /api/professional-onboarding/credentials/:credentialId`
- `DELETE /api/professional-onboarding/credentials/:credentialId`
- `PUT /api/professional-onboarding/location`
- `PUT /api/professional-onboarding/profile`
- `PATCH /api/professional-onboarding/progress`
- `POST /api/professional-onboarding/submit`
