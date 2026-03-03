'use client'

import { FolderKanban, Activity, CheckCircle, Clock, DollarSign } from 'lucide-react'
import { Card, CardContent } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import type { ProjectStats } from '@/hooks/use-projects'

interface ProjectsStatsCardsProps {
  stats: ProjectStats | undefined
  isLoading: boolean
  viewMode?: 'active' | 'legacy' | 'all'
}

function formatCurrency(amount: number): string {
  if (amount >= 1_000_000_000) {
    return `₦${(amount / 1_000_000_000).toFixed(1)}B`
  }
  if (amount >= 1_000_000) {
    return `₦${(amount / 1_000_000).toFixed(1)}M`
  }
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
      <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
        {[...Array(5)].map((_, i) => (
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

  const projectsSubtext =
    viewMode === 'all' && totals?.legacy
      ? `+ ${totals.legacy} legacy`
      : undefined

  const cards = [
    {
      label: viewMode === 'legacy' ? 'Legacy Projects' : 'Projects',
      value: totals?.total ?? 0,
      subtext: projectsSubtext,
      icon: FolderKanban,
      color: 'text-blue-600',
    },
    {
      label: 'Active',
      value: totals?.active ?? 0,
      icon: Activity,
      color: 'text-emerald-600',
    },
    {
      label: 'Completed',
      value: totals?.completed ?? 0,
      icon: CheckCircle,
      color: 'text-gray-600',
    },
    {
      label: 'Retention',
      value: totals?.retention_period ?? 0,
      icon: Clock,
      color: 'text-amber-600',
    },
    {
      label: 'Total Value',
      value: formatCurrency(totals?.total_contract_value ?? 0),
      icon: DollarSign,
      color: 'text-primary',
      isText: true,
    },
  ]

  return (
    <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
      {cards.map((card) => (
        <Card key={card.label}>
          <CardContent className="pt-6">
            <div className="flex items-center gap-3">
              <card.icon className={`h-5 w-5 ${card.color}`} />
              <div>
                <p className="text-xs text-muted-foreground">{card.label}</p>
                <p className="text-xl font-bold">{card.value}</p>
                {'subtext' in card && card.subtext && (
                  <p className="text-[11px] text-muted-foreground">{card.subtext}</p>
                )}
              </div>
            </div>
          </CardContent>
        </Card>
      ))}
    </div>
  )
}
