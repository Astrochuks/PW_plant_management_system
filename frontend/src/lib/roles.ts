/**
 * The role vocabulary — one place, so a role never gets spelled two ways.
 *
 * Migration 029 split the old `management` role into the two seats it
 * always stood for: the Managing Director and the General Project Manager.
 * They see the same thing today, so every gate asks `isManagementRole`
 * rather than naming a role. `management` itself is retired — never
 * offered, never written — but still recognised so an old row or a cached
 * session never loses access.
 */

export const USER_ROLES = [
  'admin',
  'managing_director',
  'general_project_manager',
  'plant_officer',
  'site_engineer',
] as const

export type UserRole = (typeof USER_ROLES)[number]

/** Includes the retired value — for reading rows, not for writing. */
export type StoredRole = UserRole | 'management'

export const ROLE_LABELS: Record<StoredRole, string> = {
  admin: 'Admin',
  managing_director: 'Managing Director',
  general_project_manager: 'General Project Manager',
  plant_officer: 'Plant Officer',
  site_engineer: 'Site Engineer',
  management: 'Management',
}

export const ROLE_DESCRIPTIONS: Record<StoredRole, string> = {
  admin: 'Full access to all features and user management',
  managing_director:
    'Read access to plants, projects, reports, and analytics',
  general_project_manager:
    'Read access to plants, projects, reports, and analytics',
  plant_officer:
    'Plant module only — same plant access as management, no projects',
  site_engineer: 'Can fill and submit weekly reports for their assigned site',
  management: 'Retired role — reassign to Managing Director or GPM',
}

const MANAGEMENT_ROLES = new Set<string>([
  'managing_director',
  'general_project_manager',
  'management',
])

/** The MD/GPM tier — what the old `role === 'management'` check meant. */
export const isManagementRole = (role: string | undefined | null): boolean =>
  !!role && MANAGEMENT_ROLES.has(role)

export const roleLabel = (role: string): string =>
  ROLE_LABELS[role as StoredRole] ?? role
