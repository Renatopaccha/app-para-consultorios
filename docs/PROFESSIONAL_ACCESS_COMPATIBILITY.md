# Professional access compatibility

Migration 4 adds `ProfessionalAccess`, `ProfessionalAccessAuditLog`, and
`UserRoleAssignment` alongside the legacy authorization model. In this phase,
`User.role` remains the effective authorization source. Creating any of these
records does not grant, suspend, or revoke access to an existing portal.

## Legacy backfill

The safe default is a read-only plan:

```bash
npm run professional-access:backfill:plan
```

`APPLY` is deliberately separate and requires the exact confirmation token:

```bash
npm run professional-access:backfill:apply -- \
  --confirm=APPLY_LEGACY_PROFESSIONAL_ACCESS_BACKFILL
```

Production execution has a second guard:
`PROFESSIONAL_ACCESS_BACKFILL_ALLOW_PRODUCTION=true`. The tool never changes
`User.role`, `DoctorProfile`, Clerk identities, appointments, payments, or
professional applications. It only creates the compatibility records for an
unambiguous `DOCTOR + DoctorProfile + APPROVED` legacy tuple. Pending, rejected,
and suspended profiles are reported and skipped. Structural inconsistencies or
contradictory existing compatibility records abort the complete transaction.

The operation is idempotent. An equivalent second execution performs zero
creates and zero updates, so it does not touch `updatedAt`.

## Future shadow authorization (not implemented)

The next phase can calculate two independent decisions at the existing portal
authorization boundary:

```ts
{
  legacyAllowed: boolean,
  professionalAccessAllowed: boolean,
}
```

That observation should first be integrated in shadow mode near the current
`authenticate` / `requireRole` decision and the portal-resolution path. It must
emit only non-sensitive decision metadata and must not change the returned
authorization result until a separately approved cutover. No middleware or
portal resolver is changed by Migration 4.
