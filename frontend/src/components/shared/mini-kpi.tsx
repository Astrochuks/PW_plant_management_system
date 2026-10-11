'use client'

/**
 * MiniKpi — THE summary card for register-style pages (docs/UI_STANDARD.md).
 *
 * Two looks, one component:
 *  - `stat` (default, decided 2026-10-12): the figure centred and large,
 *    the label under it, no icon. Three of these sit above a table and
 *    every one of them follows the page's filters.
 *  - `compact`: icon · value · "label · sub" in one line — the Plant
 *    Register's original strip, kept until that page is restyled.
 */

import type { ElementType } from 'react'
import { Card, CardContent } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { cn } from '@/lib/utils'

export interface MiniKpiProps {
  label: string
  value: string
  sub?: string
  variant?: 'stat' | 'compact'
  icon?: ElementType
  /** tailwind text colour for the icon (compact only) */
  iconColor?: string
  /** colour the value itself (a loss, a count that needs attention) */
  tone?: 'good' | 'bad'
  className?: string
}

export function MiniKpi({ label, value, sub, variant = 'stat', icon: Icon, iconColor = 'text-primary', tone, className }: MiniKpiProps) {
  const toneClass = tone === 'bad' ? 'text-red-600' : tone === 'good' ? 'text-emerald-700 dark:text-emerald-400' : ''
  if (variant === 'compact') {
    return (
      <Card className={cn('py-0', className)}>
        <CardContent className="flex items-center gap-3 py-3 px-4">
          {Icon && <Icon className={`h-5 w-5 shrink-0 ${iconColor}`} />}
          <div className="min-w-0">
            <p className={cn('text-lg font-bold leading-tight tabular-nums', toneClass)}>{value}</p>
            <p className="text-[11px] text-muted-foreground leading-tight truncate" title={sub ? `${label} · ${sub}` : label}>
              {label}{sub ? <> &middot; {sub}</> : null}
            </p>
          </div>
        </CardContent>
      </Card>
    )
  }
  return (
    <Card className={cn('py-0', className)}>
      <CardContent className="flex flex-col items-center justify-center gap-1 px-6 py-5 text-center">
        <p className={cn('whitespace-nowrap text-2xl font-bold leading-none tabular-nums tracking-tight sm:text-3xl', toneClass)}>{value}</p>
        <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{label}</p>
        {sub && <p className="text-xs text-muted-foreground">{sub}</p>}
      </CardContent>
    </Card>
  )
}

/**
 * The row of summary cards. Cards share the width equally but never
 * shrink below their own content (`min-w-max`), so a long naira figure
 * widens its card instead of spilling out; when the row cannot fit, cards
 * wrap to the next line. No card needs a width of its own.
 */
export function MiniKpiRow({ children }: { children: React.ReactNode }) {
  return <div className="flex flex-wrap gap-3 [&>*]:flex-1 [&>*]:min-w-max">{children}</div>
}

/** A fixed-column grid, for pages that still use the compact strip. */
export function MiniKpiGrid({ children, cols = 3 }: { children: React.ReactNode; cols?: 2 | 3 | 4 }) {
  const grid = cols === 4 ? 'sm:grid-cols-2 xl:grid-cols-4' : cols === 2 ? 'sm:grid-cols-2' : 'sm:grid-cols-3'
  return <div className={`grid grid-cols-1 gap-3 ${grid}`}>{children}</div>
}

export function MiniKpiSkeleton({ count = 3, variant = 'stat' }: { count?: number; variant?: 'stat' | 'compact' }) {
  return (
    <>
      {Array.from({ length: count }, (_, i) => (
        <Card key={i} className="py-0">
          <CardContent className={variant === 'stat' ? 'flex flex-col items-center gap-2 px-6 py-5' : 'flex items-center gap-3 py-3 px-4'}>
            {variant === 'compact' && <Skeleton className="h-5 w-5 rounded" />}
            <div className={variant === 'stat' ? 'flex flex-col items-center gap-2' : 'space-y-1.5'}>
              <Skeleton className={variant === 'stat' ? 'h-8 w-28' : 'h-5 w-16'} />
              <Skeleton className="h-3 w-24" />
            </div>
          </CardContent>
        </Card>
      ))}
    </>
  )
}
