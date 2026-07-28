export interface CatalogItemDto { id: string; name: string; }

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
