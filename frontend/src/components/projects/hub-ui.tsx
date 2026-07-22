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
    <span className="absolute -top-2.5 left-4 z-10 inline-flex max-w-[85%] items-center gap-1.5 truncate rounded bg-card px-2 text-sm font-semibold">
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

export function Kpi({ label, value, sub, lineage, tone }: {
  label: string
  value: string
  sub?: string
  lineage?: string
  tone?: 'good' | 'bad'
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
      </CardContent>
    </Card>
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
