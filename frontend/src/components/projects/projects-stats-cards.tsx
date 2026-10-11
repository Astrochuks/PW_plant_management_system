'use client'

import { Activity, Banknote } from 'lucide-react'
import { Card, CardContent } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { MiniKpi } from '@/components/shared/mini-kpi'
import type { ProjectStats } from '@/hooks/use-projects'
import { money as fullCurrency } from '@/lib/format';

interface ProjectsStatsCardsProps {
  stats: ProjectStats | undefined
  isLoading: boolean
  viewMode?: 'active' | 'legacy' | 'all'
}

function compactCurrency(amount: number): string {
  if (amount >= 1_000_000_000) {
    return `₦${(amount / 1_000_000_000).toFixed(1)}B`
  }
  if (amount >= 1_000_000) {
    return `₦${(amount / 1_000_000).toFixed(1)}M`
  }
  return fullCurrency(amount)
}


export function ProjectsStatsCards({ stats, isLoading, viewMode = 'all' }: ProjectsStatsCardsProps) {
  if (isLoading) {
    return (
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        {[1, 2].map((i) => (
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
      </div>
    )
  }

  const totals = stats?.totals
  const totalValue = totals?.total_contract_value ?? 0
  const count = (viewMode === 'legacy' ? totals?.total : totals?.active) ?? 0

  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
      <MiniKpi
          variant="compact"
        label={viewMode === 'legacy' ? 'Legacy Projects' : 'Active Projects'}
        value={count.toLocaleString()}
        sub={viewMode === 'legacy' ? 'historical register' : undefined}
        icon={Activity}
        iconColor="text-emerald-600 dark:text-emerald-400"
      />
      <MiniKpi
          variant="compact"
        label="Total Value"
        value={compactCurrency(totalValue)}
        sub={totalValue >= 1_000_000 ? fullCurrency(totalValue) : 'current contract sums'}
        icon={Banknote}
        iconColor="text-amber-600 dark:text-amber-400"
      />
    </div>
  )
}

