'use client'

/**
 * MiniKpi — THE summary card for register-style pages (docs/UI_STANDARD.md).
 *
 * One icon, one bold value, one muted "label · sub" line. It was born on the
 * Plant Register and copied into the Project Registry; this is the single
 * source now. The grid above a table is a row of these, and every one of
 * them follows the page's filters — a card that ignores the filters is a bug.
 */

import type { ElementType } from 'react'
import { Card, CardContent } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'

export interface MiniKpiProps {
  label: string
  value: string
  sub?: string
  icon: ElementType
  /** tailwind text colour for the icon, e.g. 'text-emerald-600 dark:text-emerald-400' */
  iconColor?: string
  /** colour the value itself (money that is a loss, a count that needs attention) */
  tone?: 'good' | 'bad'
}

export function MiniKpi({ label, value, sub, icon: Icon, iconColor = 'text-primary', tone }: MiniKpiProps) {
  return (
    <Card className="py-0">
      <CardContent className="flex items-center gap-3 py-3 px-4">
        <Icon className={`h-5 w-5 shrink-0 ${iconColor}`} />
        <div className="min-w-0">
          <p className={`text-lg font-bold leading-tight tabular-nums ${
            tone === 'bad' ? 'text-red-600' : tone === 'good' ? 'text-emerald-700 dark:text-emerald-400' : ''}`}>{value}</p>
          <p className="text-[11px] text-muted-foreground leading-tight truncate" title={sub ? `${label} · ${sub}` : label}>
            {label}{sub ? <> &middot; {sub}</> : null}
          </p>
        </div>
      </CardContent>
    </Card>
  )
}

/** A row of MiniKpis. `cols` is the column count at ≥sm; phones stack to one. */
export function MiniKpiGrid({ children, cols = 3 }: { children: React.ReactNode; cols?: 2 | 3 | 4 }) {
  const grid = cols === 4 ? 'sm:grid-cols-2 xl:grid-cols-4' : cols === 2 ? 'sm:grid-cols-2' : 'sm:grid-cols-3'
  return <div className={`grid grid-cols-1 gap-3 ${grid}`}>{children}</div>
}

export function MiniKpiSkeleton({ count = 3 }: { count?: number }) {
  return (
    <>
      {Array.from({ length: count }, (_, i) => (
        <Card key={i} className="py-0">
          <CardContent className="flex items-center gap-3 py-3 px-4">
            <Skeleton className="h-5 w-5 rounded" />
            <div className="space-y-1.5">
              <Skeleton className="h-5 w-16" />
              <Skeleton className="h-3 w-24" />
            </div>
          </CardContent>
        </Card>
      ))}
    </>
  )
}
