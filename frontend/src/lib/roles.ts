/**
 * The role vocabulary — one place, so a role never gets spelled two ways.
 *
 * Roles v3 (migration 035, 2026-10-11): four working seats.
 *   admin            — everything
 *   project_manager  — the projects module, every site (picker), approves
 *                      BEME revisions; no plant-module access
 *   site_engineer    — their own assigned project only (bills, weekly
 *                      quantities once the form exists)
 *   plant_officer    — plant module only
 *
 * `managing_director` and `general_project_manager` (029) are PARKED and
 * `management` (pre-029) is retired: never offered, never written, but
 * still recognised when read so an old row or a cached session never loses
 * access — they behave as project_manager.
 */

export const USER_ROLES = [
  'admin',
  'project_manager',
  'site_engineer',
  'plant_officer',
] as const

export type UserRole = (typeof USER_ROLES)[number]

/** Includes the parked/retired values — for reading rows, not for writing. */
export type StoredRole =
  | UserRole
  | 'managing_director'
  | 'general_project_manager'
  | 'management'

export const ROLE_LABELS: Record<StoredRole, string> = {
  admin: 'Admin',
  project_manager: 'Project Manager',
  site_engineer: 'Site Engineer',
  plant_officer: 'Plant Officer',
  managing_director: 'Project Manager (was MD)',
  general_project_manager: 'Project Manager (was GPM)',
  management: 'Project Manager (was Management)',
}

export const ROLE_DESCRIPTIONS: Record<StoredRole, string> = {
  admin: 'Full access to all features and user management',
  project_manager:
    'All projects — register, bills, weekly reports — and approves bill revisions. No plant module.',
  site_engineer:
    'Their own project only: bills and, once the form is live, this week’s quantities',
  plant_officer: 'Plant module only — no projects',
  managing_director: 'Parked role — behaves as Project Manager',
  general_project_manager: 'Parked role — behaves as Project Manager',
  management: 'Retired role — behaves as Project Manager',
}

const PROJECT_MANAGER_ROLES = new Set<string>([
  'project_manager',
  'managing_director',
  'general_project_manager',
  'management',
])

/** The project-manager seat, including the parked values it absorbed. */
export const isProjectManagerRole = (role: string | undefined | null): boolean =>
  !!role && PROJECT_MANAGER_ROLES.has(role)

export const isSiteEngineerRole = (role: string | undefined | null): boolean =>
  role === 'site_engineer'

export const roleLabel = (role: string): string =>
  ROLE_LABELS[role as StoredRole] ?? role

/**
 * Where a role lands after login — and where the logo takes them.
 * The project manager opens on the executive summary, the site engineer
 * on their own project page, everyone else on the fleet dashboard.
 */
export const homePathForRole = (role: string | undefined | null): string => {
  if (isSiteEngineerRole(role)) return '/my-site'
  if (isProjectManagerRole(role)) return '/projects/executive'
  return '/'
}
