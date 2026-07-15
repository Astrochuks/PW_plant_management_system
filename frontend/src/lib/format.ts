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

export const num = (v: number | null | undefined, dp = 0): string =>
  v == null ? '—' : v.toLocaleString('en-NG', { maximumFractionDigits: dp })

export const fmtDate = (d: string | null | undefined): string =>
  d ? new Date(d + (d.length === 10 ? 'T00:00:00' : '')).toLocaleDateString('en-GB', {
    day: '2-digit', month: 'short', year: 'numeric',
  }) : '—'

export const weekLabel = (year: number, week: number): string =>
  `${year} · W${String(week).padStart(2, '0')}`
