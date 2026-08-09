import type { ProfessionalTitle } from '../../generated/prisma';

export const PROFESSIONAL_TITLE_LABELS: Record<ProfessionalTitle, string> = {
  DR: 'Dr.',
  DRA: 'Dra.',
  DENTIST_MALE: 'Odontólogo',
  DENTIST_FEMALE: 'Odontóloga',
  PSYCHOLOGIST_MALE: 'Psicólogo',
  PSYCHOLOGIST_FEMALE: 'Psicóloga',
  LICENSED_MALE: 'Licenciado',
  LICENSED_FEMALE: 'Licenciada',
  OTHER: '',
};

export function titleLabel(title: ProfessionalTitle | null, customTitle: string | null): string | null {
  if (!title) return null;
  return title === 'OTHER' ? customTitle?.trim() || null : PROFESSIONAL_TITLE_LABELS[title];
}

export function publicDisplayName(firstName: string, lastName: string, title: ProfessionalTitle | null, customTitle: string | null): string {
  const name = `${firstName} ${lastName}`.trim();
  const label = titleLabel(title, customTitle);
  return label ? `${label} ${name}` : name;
}
