# Baseline pendiente

Este repositorio no contiene un historial de migraciones aplicable. El SQL inicial
debe generarse desde `prisma/schema.prisma` con `prisma migrate diff --from-empty`
y revisarse antes de aplicarlo.

No ejecutar `prisma migrate deploy` contra una base existente hasta establecer un
baseline que refleje exactamente su esquema real. Para una base de pruebas vacía,
generar una migración inicial y aplicarla solo allí; para una base con datos,
comparar primero el esquema real con Prisma y registrar el baseline sin reiniciar
ni borrar datos.
