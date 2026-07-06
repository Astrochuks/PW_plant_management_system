'use client'

/**
 * Register benchmarks (T1.13) — what the 2017 register teaches us:
 * contract-value ranges and actual award→completion delivery times per
 * project type. Overrun-vs-plan factors arrive with weekly-report data
 * (the legacy register has no planned durations).
 */

import { BarChart3 } from 'lucide-react'

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { useProjectBenchmarks } from '@/hooks/use-projects'

function formatNaira(value: number | null): string {
  if (value == null) return '—'
  if (value >= 1e9) return `₦${(value / 1e9).toFixed(2)}B`
  if (value >= 1e6) return `₦${(value / 1e6).toFixed(1)}M`
  return `₦${Math.round(value).toLocaleString('en-NG')}`
}

export function RegisterBenchmarks() {
  const { data, isLoading } = useProjectBenchmarks()

  if (isLoading) {
    return (
      <div className="grid gap-4 md:grid-cols-2">
        <Skeleton className="h-48" />
        <Skeleton className="h-48" />
      </div>
    )
  }
  if (!data?.length) return null

  const rows = data.filter((b) => b.n_projects > 0)

  return (
    <div className="grid gap-4 md:grid-cols-2">
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="flex items-center gap-2 text-sm font-medium">
            <BarChart3 className="h-4 w-4" />
            Contract Value by Type
            <span className="text-muted-foreground ml-auto text-xs font-normal">
              median (p25–p75)
            </span>
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-1.5">
            {rows.map((b) => (
              <div key={b.project_type} className="flex items-baseline justify-between text-sm">
                <span className="capitalize">
                  {b.project_type}
                  <span className="text-muted-foreground ml-1.5 text-xs">×{b.n_projects}</span>
                </span>
                <span className="font-medium tabular-nums">
                  {formatNaira(b.value_median)}
                  <span className="text-muted-foreground ml-1.5 text-xs font-normal">
                    ({formatNaira(b.value_p25)}–{formatNaira(b.value_p75)})
                  </span>
                </span>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="flex items-center gap-2 text-sm font-medium">
            <BarChart3 className="h-4 w-4" />
            Delivery Time by Type
            <span className="text-muted-foreground ml-auto text-xs font-normal">
              award → completion, months
            </span>
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-1.5">
            {rows
              .filter((b) => (b.n_delivered ?? 0) > 0)
              .map((b) => (
                <div key={b.project_type} className="flex items-baseline justify-between text-sm">
                  <span className="capitalize">
                    {b.project_type}
                    <span className="text-muted-foreground ml-1.5 text-xs">
                      ×{b.n_delivered} completed
                    </span>
                  </span>
                  <span className="font-medium tabular-nums">
                    {b.delivery_median_months?.toFixed(1)} mo
                    <span className="text-muted-foreground ml-1.5 text-xs font-normal">
                      ({b.delivery_p25_months?.toFixed(0)}–{b.delivery_p75_months?.toFixed(0)})
                    </span>
                  </span>
                </div>
              ))}
          </div>
          <p className="text-muted-foreground mt-3 text-[11px]">
            Actual durations from the historical register. Planned-vs-actual overrun
            tracking starts once weekly reports flow (the register records no planned
            durations).
          </p>
        </CardContent>
      </Card>
    </div>
  )
}
