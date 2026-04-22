'use client'

import {
  Truck,
  CheckCircle,
  ShieldCheck,
  MapPin,
  Map,
} from 'lucide-react'
import { Card, CardContent } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import type { DashboardPlantStats } from '@/lib/api/dashboard'

interface KpiCardsProps {
  plants: DashboardPlantStats | undefined
  totalSites: number
  totalStates: number
  isLoading: boolean
}

export function KpiCards({ plants, totalSites, totalStates, isLoading }: KpiCardsProps) {
  if (isLoading) {
    return (
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-3 sm:gap-4">
        {Array.from({ length: 5 }).map((_, i) => (
          <Skeleton key={i} className="h-[85px] sm:h-[110px]" />
        ))}
      </div>
    )
  }

  if (!plants) return null

  const verificationRate = Math.round(
    (plants.verified_plants / Math.max(plants.total_plants, 1)) * 1000
  ) / 10

  const operationalPct = Math.round(
    ((plants.working_plants + plants.standby_plants) / Math.max(plants.total_plants, 1)) * 100
  )

  return (
    <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-3 sm:gap-4">
      <KpiCard
        title="Total Sites"
        value={totalSites}
        icon={MapPin}
        iconBg="bg-blue-100 dark:bg-blue-900/50"
        iconColor="text-blue-600 dark:text-blue-400"
        subtitle="Active locations"
      />
      <KpiCard
        title="Total Fleet"
        value={plants.total_plants}
        icon={Truck}
        iconBg="bg-amber-100 dark:bg-amber-900/50"
        iconColor="text-amber-600 dark:text-amber-400"
        subtitle={`${operationalPct}% operational`}
      />
      <KpiCard
        title="Working"
        value={plants.working_plants}
        icon={CheckCircle}
        iconBg="bg-emerald-100 dark:bg-emerald-900/50"
        iconColor="text-emerald-600 dark:text-emerald-400"
        subtitle={`${Math.round((plants.working_plants / Math.max(plants.total_plants, 1)) * 100)}% of fleet`}
      />
      <KpiCard
        title="States"
        value={totalStates}
        icon={Map}
        iconBg="bg-purple-100 dark:bg-purple-900/50"
        iconColor="text-purple-600 dark:text-purple-400"
        subtitle="With active sites"
      />
      <KpiCard
        title="Verified"
        value={`${verificationRate}%`}
        icon={ShieldCheck}
        iconBg="bg-violet-100 dark:bg-violet-900/50"
        iconColor="text-violet-600 dark:text-violet-400"
        subtitle={`${plants.verified_plants} of ${plants.total_plants}`}
      />
    </div>
  )
}

function KpiCard({
  title,
  value,
  icon: Icon,
  iconBg,
  iconColor,
  subtitle,
  alert,
}: {
  title: string
  value: number | string
  icon: React.ElementType
  iconBg: string
  iconColor: string
  subtitle: string
  alert?: boolean
}) {
  const formatted = typeof value === 'number' ? value.toLocaleString() : value
  return (
    <Card className={alert ? 'border-red-200 dark:border-red-800' : undefined}>
      <CardContent className="pt-3 pb-2.5 sm:pt-5 sm:pb-4">
        <div className="flex items-start justify-between">
          <div className="min-w-0">
            <p className="text-[10px] sm:text-[11px] font-medium text-muted-foreground uppercase tracking-wider truncate">
              {title}
            </p>
            <p className="text-xl sm:text-2xl font-bold mt-0.5">{formatted}</p>
            <p className="text-[10px] sm:text-[11px] text-muted-foreground mt-0.5 truncate">{subtitle}</p>
          </div>
          <div className={`p-1.5 sm:p-2 rounded-lg shrink-0 ${iconBg}`}>
            <Icon className={`h-3.5 w-3.5 sm:h-4 sm:w-4 ${iconColor}`} />
          </div>
        </div>
      </CardContent>
    </Card>
  )
}
