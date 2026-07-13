# Auditoría y transición monetaria MVP

| Modelo | Campo actual | Clasificación | Decisión |
|---|---|---|---|
| Service | `price Float` | MVP, precio de catálogo | Se conserva temporalmente como representación compatible; `priceCents` es canónico. |
| Appointment | `paymentMethod`, `paymentStatus` | MVP, estado/método | Se mantienen separados del importe; se añaden `paymentAmountCents` y `paymentCurrency`. |
| Appointment | `commissionAmount Float` | Futuro, comisión | Sin cambio: fuera del MVP monetario. |
| DoctorProfile | `consultationPrice Float` | Precio de perfil/búsqueda | Sin cambio: no es el precio reservado de un servicio. |
| DoctorProfile | `walletBalance Float` | Futuro, billetera | Sin cambio: no se usa en reservas MVP. |
| Kushki/Billing | parámetros `amount` | Futuro, tarjeta/suscripción | Sin cambio: fuera de alcance. |

Los snapshots de `Appointment` son opcionales durante transición para no inventar
datos de citas históricas. Todo flujo nuevo con servicio activo exige precio y
duración canónicos. Una migración futura, después de un backfill auditado, podrá
hacerlos obligatorios y retirar `Service.price`.

`backfill-service-money.ts` solo carga `.env.test`, exige `TEST_DATABASE_URL`, es
idempotente y no toca snapshots existentes.
