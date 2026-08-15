# Cutover controlado de autorización profesional

## Configuración

`PROFESSIONAL_AUTH_ENFORCEMENT_MODE` acepta exclusivamente:

- `legacy`: `User.role` conserva la decisión efectiva y no se consulta el nuevo sistema.
- `shadow`: legacy decide; ProfessionalAccess se calcula y observa en paralelo, con fail-open.
- `enforce`: un actor cuyo rol actual es `DOCTOR` debe satisfacer el resolver de ProfessionalAccess; errores de infraestructura fallan cerrados.

El default es `legacy` para que un despliegue sin configuración no active un
cutover accidental. Un valor distinto de los tres anteriores detiene el
arranque. Development no se modifica automáticamente; la activación manual es:

```dotenv
PROFESSIONAL_AUTH_ENFORCEMENT_MODE=enforce
```

No existe fallback silencioso a `User.role` para DOCTOR en modo `enforce`.

## Cobertura de rutas

### A. Cubiertas por el guard central

Toda ruta con `requireRole([...DOCTOR...])`: dashboard, perfil, servicios,
agenda, appointments, pagos, finance, reviews, certifications, patients,
calendar y workspaces. `requireRole` primero conserva la comprobación de rol.
Solo cuando el actor efectivo es DOCTOR aplica el cutover; clinic admin,
assistant y super admin no necesitan ProfessionalAccess.

### B. Ownership adicional que permanece

Los servicios y controladores continúan comprobando ownership de citas,
DoctorProfile, servicios, bloques, workspaces, clinic scope y permisos
financieros. ProfessionalAccess concede capacidad profesional global, no acceso
a cualquier recurso.

Se añadió el guard DOCTOR condicional a operaciones `authenticate-only` que sí
tenían una rama profesional:

- `GET /api/schedule-blocks`
- `GET /api/turns/today`
- `PATCH /api/bookings/:id/check-in`
- `GET /api/bookings`
- `GET /api/bookings/:id`
- callbacks OAuth de Google/Outlook cuando el `state` identifica un DOCTOR

Los demás roles de esos endpoints continúan sin cambios.

### C. No corresponden a capacidad profesional

Permanecen solo con autenticación o con sus guards actuales: sesión `/me`,
notifications, consulta de slots/disponibilidad y acciones exclusivamente
patient. Las consultas públicas de profesionales aprobados tampoco son entrada
operativa al panel.

## Respuestas API

- `PROFESSIONAL_ACCESS_REQUIRED`: onboarding pendiente o acceso aún no habilitado.
- `PROFESSIONAL_ACCESS_SUSPENDED`: acceso suspendido.
- `PROFESSIONAL_ACCESS_REVOKED`: acceso revocado.
- `PROFESSIONAL_ROLE_REVOKED`: assignment DOCTOR/GLOBAL revocado.
- `PROFESSIONAL_PROFILE_INCONSISTENT`: inconsistencia estructural, sin exponer IDs.
- `PROFESSIONAL_AUTHORIZATION_UNAVAILABLE`: error temporal del resolver, HTTP 503.

Los primeros cinco casos son HTTP 403: la identidad sigue autenticada. Los logs
son estructurados, no contienen secretos y se deduplican durante cinco minutos.
Mismatch y resolver unavailable se registran con severidad de error.

## Portal y frontend

En `enforce`, el portal profesional conserva `/dashboard` para ACTIVE y devuelve
el mismo código estructurado de denegación para los demás estados. No se anuncian
rutas de onboarding que todavía no existen.

El cliente web solo invalida sesión ante HTTP 401. Un 403 se clasifica como
`FORBIDDEN`, conserva JWT/Clerk y muestra el mensaje del backend; por eso no fue
necesario modificar frontend para este cutover. El wizard futuro podrá mapear
los códigos anteriores a pantallas de onboarding o estado.
