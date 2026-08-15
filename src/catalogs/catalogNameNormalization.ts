/**
 * Canonical normalization for human-readable catalog names only.
 *
 * This is deliberately separate from credential/registration-number rules:
 * those rules belong to each RegistrationAuthority namespace.
 */
export function normalizeCatalogName(value: string): string {
  return value
    .normalize('NFKC')
    .trim()
    .toLocaleLowerCase('es')
    .normalize('NFD')
    .replace(/\p{M}+/gu, '')
    .normalize('NFKC')
    .replace(/\s+/gu, ' ');
}
