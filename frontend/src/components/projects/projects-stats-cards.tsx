'use client'

import { Activity, DollarSign } from 'lucide-react'
import { Card, CardContent } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import type { ProjectStats } from '@/hooks/use-projects'

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

function fullCurrency(amount: number): string {
  return new Intl.NumberFormat('en-NG', {
    style: 'currency',
    currency: 'NGN',
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(amount)
}

export function ProjectsStatsCards({ stats, isLoading, viewMode = 'all' }: ProjectsStatsCardsProps) {
  if (isLoading) {
    return (
      <Card className="w-full sm:w-fit">
        <CardContent className="flex divide-x p-0">
          {[...Array(2)].map((_, i) => (
            <div key={i} className="flex-1 px-6 py-4 sm:min-w-[200px]">
              <Skeleton className="h-3 w-20 mb-2" />
              <Skeleton className="h-7 w-16" />
            </div>
          ))}
        </CardContent>
      </Card>
    )
  }

  const totals = stats?.totals
  const totalValue = totals?.total_contract_value ?? 0

  const cards = [
    {
      label: viewMode === 'legacy' ? 'Legacy Projects' : 'Active Projects',
      value: String(
        (viewMode === 'legacy' ? totals?.total : totals?.active) ?? 0
      ),
      subtext: undefined as string | undefined,
      icon: Activity,
      iconClass: 'text-emerald-600 bg-emerald-500/10',
    },
    {
      label: 'Total Value',
      value: compactCurrency(totalValue),
      subtext: totalValue >= 1_000_000 ? fullCurrency(totalValue) : undefined,
      icon: DollarSign,
      iconClass: 'text-amber-600 bg-amber-500/10',
    },
  ]

  return (
    <Card className="w-full sm:w-fit">
      <CardContent className="flex divide-x p-0">
        {cards.map((card) => (
          <div
            key={card.label}
            className="flex flex-1 items-center gap-3 px-5 py-4 sm:min-w-[200px]"
          >
            <div className={`rounded-lg p-2 ${card.iconClass}`}>
              <card.icon className="h-4 w-4" />
            </div>
            <div>
              <p className="text-xs text-muted-foreground">{card.label}</p>
              <p className="text-xl font-bold leading-tight tabular-nums">{card.value}</p>
              {card.subtext && (
                <p className="text-[11px] text-muted-foreground tabular-nums">{card.subtext}</p>
              )}
            </div>
          </div>
        ))}
      </CardContent>
    </Card>
  )
}
