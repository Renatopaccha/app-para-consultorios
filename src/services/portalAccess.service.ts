import type { Role } from '../middlewares/auth.middleware';

export const REQUESTED_PORTALS = ['professional', 'clinic', 'assistant'] as const;

export type RequestedPortal = (typeof REQUESTED_PORTALS)[number];

export type PortalResolution = {
  portal: RequestedPortal;
  allowed: true;
  destination: '/dashboard' | '/portal/clinica' | '/portal/asistente';
};

const ROLE_PORTAL_RESOLUTIONS: Readonly<Record<Role, readonly PortalResolution[]>> = {
  DOCTOR: [{ portal: 'professional', allowed: true, destination: '/dashboard' }],
  CLINIC_ADMIN: [{ portal: 'clinic', allowed: true, destination: '/portal/clinica' }],
  ASSISTANT: [{ portal: 'assistant', allowed: true, destination: '/portal/asistente' }],
  // SUPER_ADMIN has no implicit portal impersonation. A dedicated administrative
  // portal must be designed explicitly rather than silently inheriting roles.
  SUPER_ADMIN: [],
  PATIENT: [],
};

export function isRequestedPortal(value: unknown): value is RequestedPortal {
  return typeof value === 'string' && (REQUESTED_PORTALS as readonly string[]).includes(value);
}

export function availablePortalsForRole(role: Role): RequestedPortal[] {
  return ROLE_PORTAL_RESOLUTIONS[role].map((resolution) => resolution.portal);
}

export function resolvePortalForRole(role: Role, portal: RequestedPortal): PortalResolution | null {
  return ROLE_PORTAL_RESOLUTIONS[role].find((resolution) => resolution.portal === portal) ?? null;
}
