# Baseline de Prisma

`20260713_zenda_initial_baseline` es el baseline completo generado desde el
`prisma/schema.prisma` vigente mediante:

```sh
npx prisma migrate diff --from-empty --to-schema prisma/schema.prisma --script \
  --output prisma/migrations/20260713_zenda_initial_baseline/migration.sql
```

No fue aplicado a `DATABASE_URL` durante su creación. Incluye los perfiles actuales
(`ClinicProfile`, `DoctorProfile`, `Invitation`, etc.), enums, índices y claves
foráneas; el SQL no contiene `DROP`.

## PostgreSQL local vacío

Configura `DATABASE_URL` para una base explícitamente nueva y vacía y ejecuta una
sola vez `npx prisma migrate deploy`. Los cambios posteriores se hacen mediante
migraciones normales; no mediante `db push`.

## Base existente con datos

No ejecutes este baseline ni `migrate reset`. Haz respaldo y compara primero el
esquema real con Prisma; después prepara un baseline/adopción específico. Aplicar
una migración inicial a tablas existentes puede fallar o dañar el historial.

## Pruebas aisladas

Las integraciones usan exclusivamente `TEST_DATABASE_URL`, que se rechaza si no es
PostgreSQL local y si el nombre de base no incluye `test`. Nunca hay fallback a
`DATABASE_URL`.

```sh
npm run db:test:up
npm run db:test:migrate
npm run test:integration
npm run db:test:down
```

`postgres-test` usa almacenamiento temporal (`tmpfs`) y `db:test:down` elimina
cualquier volumen residual. `db:test:migrate` utiliza `prisma/test.config.ts`.
