/** Shared display formatters (locked conventions — see CLAUDE.md rule 1). */

const CURRENCY_LOCALES: Record<string, string> = {
  NGN: 'en-NG', GBP: 'en-GB', EUR: 'de-DE', USD: 'en-US',
}

/**
 * Decimal places kept before display.
 *
 * Money is `numeric` in Postgres (exact), but `_record_to_dict` converts
 * Decimal to float on the way out, and IEEE-754 cannot represent most
 * decimal fractions — 34.211 arrives as 34.210999999999999. Capping here
 * suppresses that artifact without touching any real figure: nothing in
 * this system legitimately carries more than six decimals (money has 2,
 * FX rates 4, workbook quantities 3).
 *
 * This is a floor under float noise, NOT a rounding policy. The real fix
 * is to carry money as a string end to end.
 */
const MAX_DP = 6

/**
 * A money figure, exactly as stored.
 *
 * Never rounds to whole units. ₦11,542.27 renders as ₦11,542.27, and
 * ₦10,737 renders as ₦10,737 — no invented ".00", no lost kobo. This
 * replaces ten separate local `formatCurrency` definitions, most of which
 * rounded naira to zero decimals and several of which abbreviated
 * ₦1,234,567 to "₦1.2M".
 */
export const money = (
  v: number | string | null | undefined,
  currency = 'NGN',
): string => {
  if (v == null || v === '') return '—'
  const n = typeof v === 'string' ? Number(v) : v
  if (!Number.isFinite(n)) return '—'
  const code = (currency || 'NGN').toUpperCase()
  try {
    return new Intl.NumberFormat(CURRENCY_LOCALES[code] ?? 'en-US', {
      style: 'currency',
      currency: code,
      // Money carries 2 decimals even when they are zero — the purchase
      // order documents write 802,620.00 and 1,073.70, so matching them
      // is what makes a figure reconcilable at a glance. More than 2 are
      // shown when they exist; none are ever dropped.
      minimumFractionDigits: 2,
      maximumFractionDigits: MAX_DP,
    }).format(n)
  } catch {
    // unknown ISO code — still show the exact number rather than nothing
    return `${code} ${num(n, MAX_DP)}`
  }
}

/**
 * Short form for a headline or a chart axis.
 *
 * ABBREVIATION IS ROUNDING — "₦1.2M" hides ₦34,567. Only use this where
 * the exact figure is also on screen (beside it, beneath it, or in the
 * tooltip). Never as a number's only representation. See CLAUDE.md rule 1.
 */
export const compact = (v: number | null | undefined): string => {
  if (v == null || !Number.isFinite(v)) return '—'
  const abs = Math.abs(v)
  if (abs >= 1e9) return `₦${(v / 1e9).toFixed(2)}B`
  if (abs >= 1e6) return `₦${(v / 1e6).toFixed(1)}M`
  if (abs >= 1e3) return `₦${(v / 1e3).toFixed(0)}K`
  return money(v)
}

/**
 * @deprecated Use `money()` for exact figures, or `compact()` for a
 * headline that also shows the exact value. Kept so existing call sites
 * keep compiling; `naira(v)` no longer rounds to whole naira.
 */
export const naira = (v: number | null | undefined, useCompact = false): string =>
  v == null ? '—' : useCompact ? compact(v) : money(v)

export const pctFmt = (v: number | null | undefined, dp = 1): string =>
  v == null ? '—' : `${(v * 100).toFixed(dp)}%`

/**
 * ₦ millions, the KPI-dashboard unit: 12,798.4 means ₦12,798,400,000.
 *
 * A unit conversion, so it necessarily loses precision — same rule as
 * `compact()`: only where the exact figure is also shown.
 */
export const nairaM = (v: number | null | undefined, dp = 1): string =>
  v == null ? '—'
  : (v / 1e6).toLocaleString('en-NG', {
      minimumFractionDigits: dp, maximumFractionDigits: dp,
    })

/**
 * A plain number, exactly as stored.
 *
 * Defaults to showing every real decimal — `34.211` renders as `34.211`,
 * not `34`. Pass an explicit `dp` only when a fixed precision is
 * genuinely wanted (a percentage, a chart axis).
 */
export const num = (v: number | null | undefined, dp = MAX_DP): string =>
  v == null || !Number.isFinite(v)
    ? '—'
    : v.toLocaleString('en-NG', { maximumFractionDigits: dp })

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
