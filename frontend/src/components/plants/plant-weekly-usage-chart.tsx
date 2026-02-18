'use client'

import { useMemo } from 'react'
import ECharts from 'echarts-for-react'
import { BarChart3, Clock, AlertTriangle, Gauge } from 'lucide-react'
import { Card, CardContent } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { Skeleton } from '@/components/ui/skeleton'
import type { WeeklyUsageRecord } from '@/lib/api/plants'

interface PlantWeeklyUsageChartProps {
  records: WeeklyUsageRecord[]
  isLoading?: boolean
}

export function PlantWeeklyUsageChart({ records, isLoading }: PlantWeeklyUsageChartProps) {
  // Compute summary stats
  const stats = useMemo(() => {
    if (!records || records.length === 0) return null

    const totalWorked = records.reduce((s, r) => s + Number(r.hours_worked || 0), 0)
    const totalStandby = records.reduce((s, r) => s + Number(r.standby_hours || 0), 0)
    const totalBreakdown = records.reduce((s, r) => s + Number(r.breakdown_hours || 0), 0)
    const totalHours = totalWorked + totalStandby + totalBreakdown
    const utilization = totalHours > 0 ? Math.round((totalWorked / totalHours) * 100) : 0

    return { totalWorked, totalStandby, totalBreakdown, utilization, weeks: records.length }
  }, [records])

  // Sort records for chart (ascending) and table (descending)
  const sortedAsc = useMemo(() => {
    if (!records || records.length === 0) return []
    return [...records].sort((a, b) => {
      if (a.year !== b.year) return a.year - b.year
      return a.week_number - b.week_number
    })
  }, [records])

  const sortedDesc = useMemo(() => [...sortedAsc].reverse(), [sortedAsc])

  // Chart option
  const chartOption = useMemo(() => {
    if (sortedAsc.length <= 1) return null

    const categories = sortedAsc.map((r) => `W${r.week_number} '${String(r.year).slice(2)}`)

    // Build tooltip data for week ending dates
    const weekEndings = sortedAsc.map((r) => {
      if (!r.week_ending_date) return ''
      return new Date(r.week_ending_date).toLocaleDateString('en-NG', {
        day: 'numeric',
        month: 'short',
        year: 'numeric',
      })
    })

    return {
      tooltip: {
        trigger: 'axis',
        axisPointer: { type: 'shadow' },
        formatter: (params: any[]) => {
          const idx = params[0]?.dataIndex ?? 0
          const ending = weekEndings[idx]
          let html = `<strong>${categories[idx]}</strong>`
          if (ending) html += `<br/><span style="color:#888">${ending}</span>`
          params.forEach((p: any) => {
            html += `<br/>${p.marker} ${p.seriesName}: <strong>${Number(p.value).toFixed(1)}h</strong>`
          })
          return html
        },
      },
      legend: {
        data: ['Working', 'Standby', 'Breakdown'],
        bottom: 0,
      },
      grid: {
        left: '3%',
        right: '4%',
        bottom: '40px',
        top: '12px',
        containLabel: true,
      },
      xAxis: {
        type: 'category',
        data: categories,
        axisLabel: { fontSize: 11 },
      },
      yAxis: {
        type: 'value',
        name: 'Hours',
        nameTextStyle: { fontSize: 11 },
      },
      series: [
        {
          name: 'Working',
          type: 'bar',
          stack: 'hours',
          data: sortedAsc.map((r) => Number(r.hours_worked || 0)),
          itemStyle: { color: '#10b981' },
        },
        {
          name: 'Standby',
          type: 'bar',
          stack: 'hours',
          data: sortedAsc.map((r) => Number(r.standby_hours || 0)),
          itemStyle: { color: '#3b82f6' },
        },
        {
          name: 'Breakdown',
          type: 'bar',
          stack: 'hours',
          data: sortedAsc.map((r) => Number(r.breakdown_hours || 0)),
          itemStyle: { color: '#ef4444' },
        },
      ],
    }
  }, [sortedAsc])

  if (isLoading) {
    return (
      <div className="space-y-4">
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-20 rounded-lg" />
          ))}
        </div>
        <Skeleton className="h-64 w-full rounded-lg" />
      </div>
    )
  }

  if (!records || records.length === 0 || !stats) {
    return (
      <div className="text-center py-12">
        <BarChart3 className="h-10 w-10 mx-auto text-muted-foreground/50 mb-3" />
        <p className="font-medium">No usage data available</p>
        <p className="text-sm text-muted-foreground mt-1">
          Weekly usage records will appear here once reports are submitted.
        </p>
      </div>
    )
  }

  return (
    <div className="space-y-5">
      {/* Summary Cards */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <SummaryCard
          icon={Clock}
          label="Hours Worked"
          value={formatHours(stats.totalWorked)}
          color="text-emerald-600 dark:text-emerald-400"
        />
        <SummaryCard
          icon={Clock}
          label="Standby Hours"
          value={formatHours(stats.totalStandby)}
          color="text-blue-600 dark:text-blue-400"
        />
        <SummaryCard
          icon={AlertTriangle}
          label="Breakdown Hours"
          value={formatHours(stats.totalBreakdown)}
          color="text-red-600 dark:text-red-400"
        />
        <SummaryCard
          icon={Gauge}
          label="Utilization"
          value={`${stats.utilization}%`}
          color={stats.utilization >= 70 ? 'text-emerald-600 dark:text-emerald-400' : 'text-amber-600 dark:text-amber-400'}
          sub={`${stats.weeks} week${stats.weeks !== 1 ? 's' : ''} tracked`}
        />
      </div>

      {/* Chart (only if > 1 week) */}
      {chartOption && (
        <Card>
          <CardContent className="pt-4">
            <div className="w-full h-64">
              <ECharts option={chartOption} style={{ width: '100%', height: '100%' }} />
            </div>
          </CardContent>
        </Card>
      )}

      {/* Data Table */}
      <div className="rounded-md border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-[70px]">Week</TableHead>
              <TableHead className="w-[60px]">Year</TableHead>
              <TableHead className="w-[100px]">Week Ending</TableHead>
              <TableHead>Site</TableHead>
              <TableHead className="w-[90px] text-right">Worked</TableHead>
              <TableHead className="w-[90px] text-right">Standby</TableHead>
              <TableHead className="w-[90px] text-right">Breakdown</TableHead>
              <TableHead>Remarks</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {sortedDesc.map((r, i) => (
              <TableRow key={i}>
                <TableCell className="font-medium">W{r.week_number}</TableCell>
                <TableCell>{r.year}</TableCell>
                <TableCell className="text-sm text-muted-foreground">
                  {r.week_ending_date
                    ? new Date(r.week_ending_date).toLocaleDateString('en-NG', {
                        day: 'numeric',
                        month: 'short',
                      })
                    : '-'}
                </TableCell>
                <TableCell className="text-sm text-muted-foreground truncate max-w-[150px]" title={r.location_name || ''}>
                  {r.location_name || '-'}
                </TableCell>
                <TableCell className="text-right font-mono text-sm">
                  {Number(r.hours_worked || 0).toFixed(1)}
                </TableCell>
                <TableCell className="text-right font-mono text-sm">
                  {Number(r.standby_hours || 0).toFixed(1)}
                </TableCell>
                <TableCell className="text-right font-mono text-sm">
                  {Number(r.breakdown_hours || 0) > 0 ? (
                    <span className="text-red-600 dark:text-red-400">
                      {Number(r.breakdown_hours).toFixed(1)}
                    </span>
                  ) : (
                    '0.0'
                  )}
                </TableCell>
                <TableCell className="max-w-[200px]">
                  <div className="flex items-center gap-1.5">
                    {r.off_hire && (
                      <Badge variant="outline" className="text-[10px] shrink-0">Off Hire</Badge>
                    )}
                    {r.remarks && (
                      <span className="text-xs text-muted-foreground truncate" title={r.remarks}>
                        {r.remarks}
                      </span>
                    )}
                    {!r.off_hire && !r.remarks && '-'}
                  </div>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </div>
  )
}

function SummaryCard({
  icon: Icon,
  label,
  value,
  color,
  sub,
}: {
  icon: React.ElementType
  label: string
  value: string
  color: string
  sub?: string
}) {
  return (
    <Card>
      <CardContent className="pt-3 pb-3 px-4">
        <div className="flex items-center justify-between mb-1">
          <Icon className={`h-4 w-4 ${color}`} />
        </div>
        <p className={`text-xl font-bold ${color}`}>{value}</p>
        <p className="text-xs text-muted-foreground">{label}</p>
        {sub && <p className="text-[10px] text-muted-foreground mt-0.5">{sub}</p>}
      </CardContent>
    </Card>
  )
}

function formatHours(hours: number): string {
  return hours % 1 === 0 ? String(hours) : hours.toFixed(1)
}
