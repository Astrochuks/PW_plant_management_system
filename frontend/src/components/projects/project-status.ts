/**
 * Project status labels and styles — shared by the hub, history, archive,
 * my-site and the dashboard. Lived in the old registry table until that
 * page was deleted (2026-10-12).
 */

// Two statuses (migration 042): active = Ongoing, archived = Archived — plus
// the 'legacy' bucket that effectiveStatus() derives from is_legacy
export const STATUS_STYLES: Record<string, { label: string; variant: 'default' | 'secondary' | 'destructive' | 'outline'; className?: string }> = {
  active: { label: 'Ongoing', variant: 'default', className: 'bg-emerald-600 hover:bg-emerald-600 text-white' },
  archived: { label: 'Archived', variant: 'secondary', className: 'bg-gray-200 text-gray-700' },
  legacy: { label: 'Legacy', variant: 'outline', className: 'bg-blue-50 text-blue-700 border-blue-200' },
}

/** the label the register speaks in */
export const statusLabel = (status: string): string => STATUS_STYLES[status]?.label ?? status

// is_legacy is the source of truth for the legacy bucket — a project
// flagged legacy reads "Legacy" everywhere, whatever its lifecycle status
export const effectiveStatus = (p: { status: string; is_legacy?: boolean }): string =>
  p.is_legacy ? 'legacy' : p.status
