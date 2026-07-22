'use client'

/**
 * Shared visual language for the project hub — THE standard for every
 * hub page (and any card nested in another card):
 *  - Legend: card titles embedded in the border line (fieldset style)
 *  - Kpi: soft borderless number panels (never button-shaped)
 *  - InfoChip: plain inline context text with an icon — no box
 */

import { Card, CardContent } from '@/components/ui/card'

export function Legend({ children }: { children: React.ReactNode }) {
  return (
    <span className="absolute -top-2.5 left-4 z-10 inline-flex max-w-[85%] items-center gap-1.5 truncate rounded bg-card px-2 text-sm font-bold">
      {children}
    </span>
  )
}

/** Small variant for boxes nested inside a card. */
export function LegendSm({ children }: { children: React.ReactNode }) {
  return (
    <span className="absolute -top-2 left-3 z-10 inline-flex max-w-[85%] items-center gap-1 truncate rounded bg-card px-1.5 text-xs font-semibold">
      {children}
    </span>
  )
}

export function Kpi({ label, value, sub, lineage, tone, extra }: {
  label: string
  value: string
  sub?: string
  lineage?: string
  tone?: 'good' | 'bad'
  extra?: React.ReactNode
}) {
  return (
    <Card className="border-0 bg-muted/40 shadow-none">
      <CardContent className="p-3.5">
        <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">{label}</p>
        <p className={`mt-0.5 text-xl font-bold tabular-nums ${
          tone === 'bad' ? 'text-red-600' : tone === 'good' ? 'text-emerald-700 dark:text-emerald-400' : ''
        }`}>{value}</p>
        {sub && <p className="truncate text-xs tabular-nums text-muted-foreground" title={sub}>{sub}</p>}
        {lineage && <p className="mt-0.5 truncate text-[11px] text-muted-foreground" title={lineage}>{lineage}</p>}
        {extra && <div className="mt-1.5">{extra}</div>}
      </CardContent>
    </Card>
  )
}

/** Change chip vs a previous period — % for money, points for ratios. */
export function Delta({ now, prev, prevLabel, downIsGood, pts, dp = 1 }: {
  now: number; prev: number | null; prevLabel: string
  downIsGood?: boolean; pts?: boolean; dp?: number
}) {
  if (prev == null) return null
  const diff = now - prev
  const raw = pts ? diff * 100 : prev !== 0 ? (diff / prev) * 100 : null
  if (raw == null || Math.abs(raw) < 0.5 / 10 ** dp) {
    return (
      <span className="inline-flex rounded-full bg-muted px-1.5 py-0.5 text-[11px] text-muted-foreground">
        no change vs {prevLabel}
      </span>
    )
  }
  const up = diff > 0
  const good = downIsGood ? !up : up
  const label = `${up ? '+' : ''}${raw.toFixed(dp)}${pts ? ' pts' : '%'}`
  return (
    <span className={`inline-flex items-center gap-0.5 rounded-full px-1.5 py-0.5 text-[11px] font-medium tabular-nums ${
      good
        ? 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-400'
        : 'bg-red-500/10 text-red-600'
    }`}>
      {up ? '▲' : '▼'} {label} vs {prevLabel}
    </span>
  )
}

export function InfoChip({ icon: Icon, label, value }: {
  icon: React.ComponentType<{ className?: string }>
  label: string
  value: string
}) {
  return (
    <div className="flex items-center gap-2">
      <Icon className="h-4 w-4 text-amber-600" />
      <span className="text-xs text-muted-foreground">{label}</span>
      <span className="text-sm font-semibold tabular-nums">{value}</span>
    </div>
  )
}

// FIXED per-category cost colors — shared by the Overview donut, its
// table dots, and the analytics charts. Never index-cycled.
export const CATEGORY_COLORS: Record<string, string> = {
  'Materials': '#3b82f6',
  'Plant': '#f59e0b',
  'AGO': '#8b5cf6',
  'Local Labour': '#10b981',
  'Site Level Expenses': '#06b6d4',
  'Overheads': '#f43f5e',
  'Sub Contractors': '#14b8a6',
  'Uncategorised': '#94a3b8',
}
const FALLBACK_COLORS = ['#eab308', '#64748b', '#ec4899', '#84cc16']

export function categoryColor(name: string, i: number): string {
  return CATEGORY_COLORS[name] ?? FALLBACK_COLORS[i % FALLBACK_COLORS.length]
}
