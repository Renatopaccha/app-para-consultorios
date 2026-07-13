# Diagnóstico no destructivo de drift

Durante este baseline no se aplicó ninguna migración ni se ejecutó `db push` contra
`DATABASE_URL`. Para inspeccionar una base existente, configura la URL explícitamente,
haz un respaldo y luego ejecuta:

```sh
npx prisma migrate status
npx prisma migrate diff --from-schema-datasource --to-schema prisma/schema.prisma --script
```

Revisa el SQL antes de actuar. Si existen datos o tablas, no uses `prisma migrate
reset`; documenta el drift y prepara una migración de adopción.
