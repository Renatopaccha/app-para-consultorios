export interface CatalogItemDto { id: string; name: string; }

export type DoctorWorkspaceMode = 'INDEPENDENT' | 'CLINIC';
export type DoctorWorkspaceLocationType = 'INDEPENDENT_OFFICE' | 'CLINIC';

export interface DoctorWorkspaceDto {
  doctorProfileId: string;
  mode: DoctorWorkspaceMode;
  selectedClinicId: string | null;
  locations: Array<{
    id: string;
    name: string;
    type: DoctorWorkspaceLocationType;
    isActive: true;
  }>;
}

export interface DoctorProfileDto {
  id: string;
  firstName: string;
  lastName: string;
  email: string;
  phone: string | null;
  licenseNumber: string;
  bio: string | null;
  languages: string[];
  profileImageUrl: string | null;
  profileImageUrls: { original: string; avatar: string; profile: string } | null;
  professionCode: 'MEDICINE' | 'DENTISTRY' | 'PSYCHOLOGY' | 'NURSING' | 'OTHER' | null;
  displayTitle: 'DR' | 'DRA' | 'DENTIST_MALE' | 'DENTIST_FEMALE' | 'PSYCHOLOGIST_MALE' | 'PSYCHOLOGIST_FEMALE' | 'LICENSED_MALE' | 'LICENSED_FEMALE' | 'OTHER' | null;
  customDisplayTitle: string | null;
  publicDisplayName: string;
  primarySpecialtyName: string | null;
  specialties: CatalogItemDto[];
  insurances: CatalogItemDto[];
  availableSpecialties: CatalogItemDto[];
  availableInsurances: CatalogItemDto[];
}

export interface UpdateDoctorProfileInput {
  firstName?: string;
  lastName?: string;
  phone?: string | null;
  bio?: string | null;
  languages?: string[];
  specialtyIds?: string[];
  insuranceIds?: string[];
  professionCode?: 'MEDICINE' | 'DENTISTRY' | 'PSYCHOLOGY' | 'NURSING' | 'OTHER' | null;
  displayTitle?: 'DR' | 'DRA' | 'DENTIST_MALE' | 'DENTIST_FEMALE' | 'PSYCHOLOGIST_MALE' | 'PSYCHOLOGIST_FEMALE' | 'LICENSED_MALE' | 'LICENSED_FEMALE' | 'OTHER' | null;
  customDisplayTitle?: string | null;
}

export interface DoctorServiceDto {
  id: string;
  name: string;
  description: string | null;
  priceCents: number;
  currency: 'USD';
  durationMinutes: number;
  isActive: boolean;
  clinicId: string | null;
}

export interface CreateDoctorServiceInput {
  name: string;
  description?: string | null;
  priceCents: number;
  durationMinutes: number;
  clinicId?: string | null;
}

export interface UpdateDoctorServiceInput extends Partial<CreateDoctorServiceInput> {}

export interface UpdateDoctorServiceStatusInput { isActive: boolean; }

export interface ValidationErrorResponse {
  error: 'VALIDATION_ERROR';
  message: string;
  fields: Record<string, string>;
}
