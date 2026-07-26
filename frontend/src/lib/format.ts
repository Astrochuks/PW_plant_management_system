/** Shared display formatters for the project hub (locked conventions). */

export const naira = (v: number | null | undefined, compact = false): string => {
  if (v == null) return '—'
  if (compact) {
    const abs = Math.abs(v)
    if (abs >= 1e9) return `₦${(v / 1e9).toFixed(2)}B`
    if (abs >= 1e6) return `₦${(v / 1e6).toFixed(1)}M`
    if (abs >= 1e3) return `₦${(v / 1e3).toFixed(0)}K`
  }
  return new Intl.NumberFormat('en-NG', {
    style: 'currency', currency: 'NGN', maximumFractionDigits: 0,
  }).format(v)
}

export const pctFmt = (v: number | null | undefined, dp = 1): string =>
  v == null ? '—' : `${(v * 100).toFixed(dp)}%`

/** ₦ millions, the KPI-dashboard unit: 12,798.4 means ₦12,798,400,000. */
export const nairaM = (v: number | null | undefined, dp = 1): string =>
  v == null ? '—'
  : (v / 1e6).toLocaleString('en-NG', {
      minimumFractionDigits: dp, maximumFractionDigits: dp,
    })

export const num = (v: number | null | undefined, dp = 0): string =>
  v == null ? '—' : v.toLocaleString('en-NG', { maximumFractionDigits: dp })

export const fmtDate = (d: string | null | undefined): string =>
  d ? new Date(d + (d.length === 10 ? 'T00:00:00' : '')).toLocaleDateString('en-GB', {
    day: '2-digit', month: 'short', year: 'numeric',
  }) : '—'

export const weekLabel = (year: number, week: number): string =>
  `${year} · W${String(week).padStart(2, '0')}`

/**
 * ISO-8601 week number — the week every stored `week_number` in this
 * system already means: Postgres `EXTRACT(WEEK …)` and Python's
 * `isocalendar()` both return it, and that is what the ingest and the
 * site-report submission write.
 *
 * Derived from the calendar date alone (UTC, midday-safe), so the answer
 * never shifts with the clock — the old approximation moved the week on
 * a few minutes after midnight and was a week ahead every Sunday, which
 * is exactly the day a reporting week ends.
 */
export const isoWeek = (d: Date = new Date()): number => {
  const t = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()))
  // an ISO week belongs to the year containing its Thursday
  t.setUTCDate(t.getUTCDate() + 4 - (t.getUTCDay() || 7))
  const yearStart = new Date(Date.UTC(t.getUTCFullYear(), 0, 1))
  return Math.ceil(((t.getTime() - yearStart.getTime()) / 86400000 + 1) / 7)
}
