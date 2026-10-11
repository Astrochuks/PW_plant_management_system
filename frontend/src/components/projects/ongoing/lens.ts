/**
 * The period lens for the ongoing-projects page.
 *
 * One rule, decided 2026-10-11: figures are the SUM OF THE WEEKS WE HOLD
 * for the period — never the workbook's own "to date" column, which sites
 * inflate. "All stored weeks" is therefore everything on file, not the
 * project's lifetime.
 */

import type { PortfolioWeek } from '@/lib/api/projects'

export type LensKey = 'week' | 'month' | 'quarter' | 'year' | 'stored'

export const LENS_OPTIONS: Array<{ key: LensKey; label: string }> = [
  { key: 'week', label: 'Latest week' },
  { key: 'month', label: 'Month' },
  { key: 'quarter', label: 'Quarter' },
  { key: 'year', label: 'Year' },
  { key: 'stored', label: 'All stored weeks' },
]

export interface Figures {
  works_incl_vat: number
  cost: number
  net: number
  weeks: number
  /** ISO date of the last week counted, if any */
  last_week_ending: string | null
}

export const EMPTY: Figures = { works_incl_vat: 0, cost: 0, net: 0, weeks: 0, last_week_ending: null }

const sum = (rows: PortfolioWeek[]): Figures => ({
  works_incl_vat: rows.reduce((a, r) => a + Number(r.works_incl_vat ?? 0), 0),
  cost: rows.reduce((a, r) => a + Number(r.cost ?? 0), 0),
  net: rows.reduce((a, r) => a + Number(r.net ?? 0), 0),
  weeks: rows.length,
  last_week_ending: rows.length ? rows.map((r) => r.week_ending_date).sort().slice(-1)[0] : null,
})

/** [from, to] ISO dates for a calendar lens around the as-at date */
export function lensWindow(lens: LensKey, asAt: string): [string, string] | null {
  const d = new Date(asAt + 'T00:00:00')
  const y = d.getFullYear(), m = d.getMonth()
  const iso = (x: Date) => x.toISOString().slice(0, 10)
  if (lens === 'month') return [iso(new Date(y, m, 1)), iso(new Date(y, m + 1, 0))]
  if (lens === 'quarter') { const q = Math.floor(m / 3) * 3; return [iso(new Date(y, q, 1)), iso(new Date(y, q + 3, 0))] }
  if (lens === 'year') return [`${y}-01-01`, `${y}-12-31`]
  return null
}

export function lensLabel(lens: LensKey, asAt: string): string {
  const d = new Date(asAt + 'T00:00:00')
  if (lens === 'week') return 'Latest week received per site'
  if (lens === 'month') return d.toLocaleDateString('en-GB', { month: 'long', year: 'numeric' })
  if (lens === 'quarter') return `Q${Math.floor(d.getMonth() / 3) + 1} ${d.getFullYear()}`
  if (lens === 'year') return String(d.getFullYear())
  return 'All stored weeks'
}

/** figures for one project under the lens */
export function figuresFor(series: PortfolioWeek[], projectId: string, lens: LensKey, asAt: string): Figures {
  const mine = series.filter((r) => r.project_id === projectId && r.week_ending_date <= asAt)
  if (!mine.length) return EMPTY
  if (lens === 'week') {
    const last = mine.map((r) => r.week_ending_date).sort().slice(-1)[0]
    return sum(mine.filter((r) => r.week_ending_date === last))
  }
  const w = lensWindow(lens, asAt)
  if (!w) return sum(mine)
  return sum(mine.filter((r) => r.week_ending_date >= w[0] && r.week_ending_date <= w[1]))
}

export const addFigures = (a: Figures, b: Figures): Figures => ({
  works_incl_vat: a.works_incl_vat + b.works_incl_vat,
  cost: a.cost + b.cost,
  net: a.net + b.net,
  weeks: a.weeks + b.weeks,
  last_week_ending: [a.last_week_ending, b.last_week_ending].filter(Boolean).sort().slice(-1)[0] ?? null,
})

export const marginOf = (f: Figures): number | null => (f.works_incl_vat ? f.net / f.works_incl_vat : null)
