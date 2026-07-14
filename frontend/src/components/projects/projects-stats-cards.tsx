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
      <div className="grid grid-cols-2 gap-4 md:max-w-xl">
        {[...Array(2)].map((_, i) => (
          <Card key={i}>
            <CardContent className="pt-6">
              <Skeleton className="h-4 w-20 mb-2" />
              <Skeleton className="h-8 w-16" />
            </CardContent>
          </Card>
        ))}
      </div>
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
      color: 'text-emerald-600',
    },
    {
      label: 'Total Value',
      value: compactCurrency(totalValue),
      subtext: totalValue >= 1_000_000 ? fullCurrency(totalValue) : undefined,
      icon: DollarSign,
      color: 'text-primary',
    },
  ]

  return (
    <div className="grid grid-cols-2 gap-4 md:max-w-xl">
      {cards.map((card) => (
        <Card key={card.label}>
          <CardContent className="pt-6">
            <div className="flex items-center gap-3">
              <card.icon className={`h-5 w-5 ${card.color}`} />
              <div>
                <p className="text-xs text-muted-foreground">{card.label}</p>
                <p className="text-xl font-bold tabular-nums">{card.value}</p>
                {card.subtext && (
                  <p className="text-[11px] text-muted-foreground tabular-nums">{card.subtext}</p>
                )}
              </div>
            </div>
          </CardContent>
        </Card>
      ))}
    </div>
  )
}
