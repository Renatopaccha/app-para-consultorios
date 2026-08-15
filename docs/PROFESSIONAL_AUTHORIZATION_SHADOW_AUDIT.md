# Auditoría de autorización profesional en shadow mode

La autorización efectiva sigue siendo `requireRole` sobre `User.role`. El
shadow resolver se ejecuta solamente cuando el guard de una ruta incluye
`DOCTOR`, o cuando se solicita el portal `professional`. Los filtros públicos
de profesionales aprobados no constituyen acceso al panel y permanecen fuera
del shadow guard.

| Dominio / rutas | Guard legacy | Check de perfil/verificación actual | Shadow | Riesgo previo al cutover |
|---|---|---|---|---|
| Dashboard `/api/doctors/me/dashboard-summary`, `/api/dashboard/metrics` | `DOCTOR` | DoctorProfile por `userId`; workspace en el dashboard nuevo | Común en `requireRole` | `metrics` conserva validaciones propias y puede responder distinto por datos incompletos |
| Perfil `/api/doctors/me/profile`, `/api/doctors/profile`, `/api/profile/doctor/*` | `DOCTOR` | DoctorProfile existente y ownership por `userId` | Común | Rutas legacy y canónicas coexisten |
| Servicios `/api/doctors/me/services*`, `/api/doctors/services` | `DOCTOR` | DoctorProfile/Service ownership | Común | Endpoint legacy duplicado |
| Agenda `/api/doctors/me/work-schedules`, `/api/doctors/schedules`, `/api/schedule-blocks*` | `DOCTOR` o rol profesional mixto | DoctorProfile y alcance de workspace en controladores | Común | La lectura authenticate-only usa ahora el guard DOCTOR condicional durante enforce |
| Appointments `/api/doctors/me/appointments*`, `/api/doctors/appointments`, `/api/bookings/*`, `/api/turns/*`, `/api/assistant/:id/*` | `DOCTOR` o rol mixto | Ownership adicional en lifecycle/authorization services | Común | Lecturas/check-in/today authenticate-only usan guard DOCTOR condicional; otros roles no cambian |
| Pagos `/api/cash-payments/*`, `/api/finance/*`, `/api/bookings/verify-payment` | Roles profesionales mixtos | Scope por DoctorProfile/Clinic/Assistant | Común | Rol global permite entrar; el servicio restringe el recurso después |
| Reviews `/api/doctors/me/reviews` | `DOCTOR` | DoctorProfile por `userId`; lectura pública separada | Común | Sin riesgo nuevo; la lectura pública no es autorización profesional |
| Certifications `/api/doctors/me/certifications*` | `DOCTOR` | DoctorProfile ownership; revisión administrativa separada | Común | Upload/rate limit ocurren después del guard |
| Patients `/api/doctors/patients/*` | `DOCTOR` | DoctorProfile en controlador | Común | Rutas declaradas después de `/:id`; existe riesgo legacy de precedencia de routing |
| Calendar `/api/calendar/{google,outlook}/auth`, `/api/google/*` | `DOCTOR` o `DOCTOR/CLINIC_ADMIN` | Perfil/tokens en controladores | Común | Callbacks públicos no deben ejecutar shadow profesional |
| Notifications `/api/notifications/*` | Solo `authenticate` | Ownership por `userId` | No | Multi-role; no es una capacidad exclusivamente profesional |
| Workspaces `/api/doctors/me/workspaces`, `/api/clinics/my-clinics` | `DOCTOR` | DoctorProfile y memberships activas | Común | La pertenencia al workspace sigue siendo una segunda autorización |
| Portal `/api/auth/resolve-portal` | Mapa de `User.role` | Ninguno | Observación explícita para `professional` | El portal sigue autorizando por rol aunque el nuevo sistema deniegue |

## Semántica

`legacyAllowed` es `currentRole === DOCTOR`. `professionalAccessAllowed` exige
simultáneamente una asignación `DOCTOR/GLOBAL` no revocada, un
`ProfessionalAccess ACTIVE`, y correspondencia real entre User,
DoctorProfile y el DoctorProfile referenciado por ProfessionalAccess.

`effectiveAllowed` siempre es `legacyAllowed` en esta fase. Un error de lectura
del resolver se registra de forma segura y no altera el HTTP ni bloquea al
usuario.

La observación está apagada salvo
`PROFESSIONAL_AUTH_ENFORCEMENT_MODE=shadow`. Solo se registran discrepancias o errores,
con deduplicación de cinco minutos por usuario/capacidad/código. No se incluyen
email, nombre, tokens, credenciales ni identificadores Clerk.
