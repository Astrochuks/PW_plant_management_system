/**
 * Project status labels and styles — shared by the hub, history, archive,
 * my-site and the dashboard. Lived in the old registry table until that
 * page was deleted (2026-10-12).
 */

// PRD v2 §4 lifecycle (migration 036), plus the 'legacy' bucket that
// effectiveStatus() derives from is_legacy
export const STATUS_STYLES: Record<string, { label: string; variant: 'default' | 'secondary' | 'destructive' | 'outline'; className?: string }> = {
  awarded: { label: 'Awarded', variant: 'outline' },
  mobilised: { label: 'Mobilised', variant: 'secondary', className: 'bg-sky-100 text-sky-800' },
  active: { label: 'Active', variant: 'default', className: 'bg-emerald-600 hover:bg-emerald-600 text-white' },
  suspended: { label: 'Suspended', variant: 'secondary', className: 'bg-amber-100 text-amber-800' },
  substantially_complete: { label: 'Substantially complete', variant: 'secondary', className: 'bg-teal-100 text-teal-800' },
  finally_complete: { label: 'Finally complete', variant: 'secondary', className: 'bg-gray-200 text-gray-700' },
  closed: { label: 'Closed', variant: 'secondary', className: 'bg-gray-200 text-gray-700' },
  legacy: { label: 'Legacy', variant: 'outline', className: 'bg-blue-50 text-blue-700 border-blue-200' },
}

// is_legacy is the source of truth for the legacy bucket — a project
// flagged legacy reads "Legacy" everywhere, whatever its lifecycle status
export const effectiveStatus = (p: { status: string; is_legacy?: boolean }): string =>
  p.is_legacy ? 'legacy' : p.status
