/**
 * The reporting calendar (docs/CALENDAR.md, decision 2026-10-11) — the one
 * place the frontend decides which month, quarter and year a week belongs
 * to. Pair with `isoWeek()` in lib/format.ts, which names the current week.
 *
 * Rule: a week belongs to the period that contains its THURSDAY (ISO's own
 * anchor — chosen so a week stays in the month and year its week number
 * says). Project weeks end on Friday, plant weeks on Sunday — the anchor
 * works for both, in any year, with no table.
 */

/** ISO date of the Thursday of the week that ends on `weekEnding`. */
export function anchorThursday(weekEnding: string): string {
  const d = new Date(weekEnding + 'T00:00:00')
  d.setDate(d.getDate() - ((d.getDay() - 4 + 7) % 7)) // getDay: Sunday=0 … Thursday=4
  const y = d.getFullYear(), m = String(d.getMonth() + 1).padStart(2, '0'), day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

export interface ReportPeriod { year: number; quarter: number; month: number }

/** month / quarter / year a reporting week counts in */
export function periodOf(weekEnding: string): ReportPeriod {
  const a = new Date(anchorThursday(weekEnding) + 'T00:00:00')
  return { year: a.getFullYear(), quarter: Math.floor(a.getMonth() / 3) + 1, month: a.getMonth() + 1 }
}

/** labels for chart buckets: "Sep 2026" · "Q3 2026" · "2026" */
export function monthLabel(weekEnding: string): string {
  return new Date(anchorThursday(weekEnding) + 'T00:00:00').toLocaleDateString('en-GB', { month: 'short', year: 'numeric' })
}
export function quarterLabel(weekEnding: string): string {
  const p = periodOf(weekEnding); return `Q${p.quarter} ${p.year}`
}
export function yearLabel(weekEnding: string): string {
  return String(periodOf(weekEnding).year)
}
