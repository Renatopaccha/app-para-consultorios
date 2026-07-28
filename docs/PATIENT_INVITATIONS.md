# Citas manuales con pacientes invitados

`POST /api/doctors/me/appointments` requiere JWT con rol `DOCTOR`. Para un paciente existente usa `patient.id`; para una persona sin cuenta usa `patient.firstName`, `patient.lastName`, `patient.email` y opcionalmente `patient.phone`.

```json
{
  "clinicId": "clinic-id",
  "serviceId": "service-id",
  "startsAt": "2026-10-05T09:00:00-05:00",
  "sendEmail": true,
  "patient": { "firstName": "Ana", "lastName": "Pérez", "email": "ana@example.test", "phone": "0990000000" }
}
```

No se crea una cuenta para un email nuevo. La respuesta tiene `patientLink.status: "PENDING"` y el correo contiene el enlace configurado con `PATIENT_INVITATION_REGISTER_URL`. En `development` y `test` puede incluir `patientLink.developmentToken`; producción no lo devuelve ni guarda tokens en texto plano.

El registro público (`POST /api/auth/register`) crea exclusivamente `PATIENT`, normaliza el correo y envía un token de verificación a `EMAIL_VERIFICATION_URL`. `POST /api/auth/verify-email` con `{ "token": "..." }` verifica la dirección y reclama atómicamente las citas pendientes o confirmadas vinculadas a invitaciones activas de ese correo. Citas canceladas, completadas, perdidas o en atención no se reclaman.

`PATCH /api/doctors/me/appointments/:id/invited-patient` permite al médico dueño corregir una cita aún no reclamada:

```json
{ "patient": { "firstName": "Ana", "lastName": "Pérez", "email": "correo-corregido@example.test", "phone": "0990000000" } }
```

El endpoint conserva la auditoría, invalida la invitación previa solo si ninguna otra cita pendiente la usa y no permite cambios tras el reclamo.
