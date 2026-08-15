export const PROFESSIONAL_AUTH_MODES = ['legacy', 'shadow', 'enforce'] as const;
export type ProfessionalAuthMode = (typeof PROFESSIONAL_AUTH_MODES)[number];

export function getProfessionalAuthMode(environment = process.env): ProfessionalAuthMode {
  const value = environment.PROFESSIONAL_AUTH_ENFORCEMENT_MODE ?? 'legacy';
  if (!(PROFESSIONAL_AUTH_MODES as readonly string[]).includes(value)) {
    throw new Error(
      `PROFESSIONAL_AUTH_ENFORCEMENT_MODE inválido: usa ${PROFESSIONAL_AUTH_MODES.join(', ')}.`,
    );
  }
  return value as ProfessionalAuthMode;
}

export function assertProfessionalAuthConfiguration(environment = process.env): void {
  getProfessionalAuthMode(environment);
}
