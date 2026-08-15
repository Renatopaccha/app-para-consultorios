import type { LocationPrecision, ProfessionalCredentialType } from '../../generated/prisma';

export type ExpectedRevisionDto = { expectedRevision: number };

export type IdentityAutosaveDto = ExpectedRevisionDto & {
  legalGivenNames?: string | null;
  legalFamilyNames?: string | null;
  primaryPhoneE164?: string | null;
  alternatePhoneE164?: string | null;
  practiceCountryCode?: string | null;
  healthProfessionId?: string | null;
  lastVisitedStep?: number;
};

export type SpecialtySelectionDto = ExpectedRevisionDto & {
  specialties: Array<{ specialtyId: string; isPrimary?: boolean }>;
  lastVisitedStep?: number;
};

export type CredentialWriteDto = ExpectedRevisionDto & {
  credentialType: ProfessionalCredentialType;
  countryCode: string;
  exactTitle: string;
  institutionId?: string | null;
  institutionNameSnapshot: string;
  registrationAuthorityId?: string | null;
  authorityNameSnapshot?: string | null;
  registrationNumber?: string | null;
  issuedAt?: string | null;
  expiresAt?: string | null;
  isPrimary?: boolean;
  sortOrder?: number;
  lastVisitedStep?: number;
};

export type LocationAutosaveDto = ExpectedRevisionDto & {
  name?: string | null;
  countryCode?: string | null;
  administrativeArea1?: string | null;
  administrativeArea2?: string | null;
  city?: string | null;
  street1?: string | null;
  street2?: string | null;
  reference?: string | null;
  postalCode?: string | null;
  floorNumber?: number | null;
  officeLabel?: string | null;
  instructions?: string | null;
  latitude?: number | null;
  longitude?: number | null;
  locationPrecision?: LocationPrecision;
  providerType?: string | null;
  providerPlaceId?: string | null;
  lastVisitedStep?: number;
};

export type ProfileAutosaveDto = ExpectedRevisionDto & {
  publicBio?: string | null;
  languages?: Array<{ languageId: string; proficiency?: string | null }>;
  lastVisitedStep?: number;
};

export type ProgressAutosaveDto = ExpectedRevisionDto & { lastVisitedStep: number };
export type SubmitApplicationDto = ExpectedRevisionDto;
