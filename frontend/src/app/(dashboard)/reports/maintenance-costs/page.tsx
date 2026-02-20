'use client'

import { useMemo, useState } from 'react'
import Link from 'next/link'
import ECharts from 'echarts-for-react'
import { ArrowLeft, DollarSign } from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { useMaintenanceCosts, type MaintenanceCostGroupBy } from '@/hooks/use-reports'
import { useLocationsWithStats } from '@/hooks/use-locations'
import { useFleetTypes } from '@/hooks/use-plants'

const GROUP_BY_OPTIONS: { value: MaintenanceCostGroupBy; label: string }[] = [
  { value: 'month', label: 'By Month' },
  { value: 'quarter', label: 'By Quarter' },
  { value: 'year', label: 'By Year' },
  { value: 'week', label: 'By Week' },
  { value: 'fleet_type', label: 'By Fleet Type' },
  { value: 'location', label: 'By Location' },
  { value: 'plant', label: 'By Plant' },
]

const currentYear = new Date().getFullYear()
const YEAR_OPTIONS = Array.from({ length: 5 }, (_, i) => currentYear - i)

function formatNGN(amount: number): string {
  return new Intl.NumberFormat('en-NG', {
    style: 'currency',
    currency: 'NGN',
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(amount)
}

export default function MaintenanceCostsPage() {
  const [year, setYear] = useState<number>(currentYear)
  const [locationId, setLocationId] = useState<string>('')
  const [fleetType, setFleetType] = useState<string>('')
  const [groupBy, setGroupBy] = useState<MaintenanceCostGroupBy>('month')

  const { data: locations = [] } = useLocationsWithStats()
  const { data: fleetTypes = [] } = useFleetTypes()

  const params = useMemo(() => {
    const p: {
      year?: number
      location_id?: string
      fleet_type?: string
      group_by: MaintenanceCostGroupBy
    } = { group_by: groupBy }
    if (year) p.year = year
    if (locationId) p.location_id = locationId
    if (fleetType) p.fleet_type = fleetType
    return p
  }, [year, locationId, fleetType, groupBy])

  const { data: response, isLoading } = useMaintenanceCosts(params)
  const costData = response?.data ?? []
  const meta = response?.meta

  const chartOption = useMemo(() => {
    if (costData.length === 0) return null

    const isTimeBased = ['week', 'month', 'quarter', 'year'].includes(groupBy)
    const labels = costData.map((d) => String(d.period || ''))

    return {
      tooltip: {
        trigger: 'axis',
        axisPointer: { type: isTimeBased ? 'line' : 'shadow' },
        formatter: (params: unknown[]) => {
          const p = params as Array<{ name: string; value: number; marker: string; seriesName: string }>
          let html = `<strong>${p[0]?.name}</strong>`
          p.forEach((item) => {
            html += `<br/>${item.marker} ${item.seriesName}: <strong>${formatNGN(Number(item.value))}</strong>`
          })
          return html
        },
      },
      grid: {
        left: '3%',
        right: '4%',
        bottom: '40px',
        top: '12px',
        containLabel: true,
      },
      xAxis: isTimeBased
        ? {
            type: 'category' as const,
            data: labels,
            axisLabel: { fontSize: 11, rotate: labels.length > 12 ? 30 : 0 },
          }
        : {
            type: 'value' as const,
            axisLabel: {
              fontSize: 11,
              formatter: (v: number) => formatNGN(v),
            },
          },
      yAxis: isTimeBased
        ? {
            type: 'value' as const,
            axisLabel: {
              fontSize: 11,
              formatter: (v: number) => formatNGN(v),
            },
          }
        : {
            type: 'category' as const,
            data: labels,
            axisLabel: { fontSize: 11 },
          },
      series: [
        {
          name: 'Total Cost',
          type: 'bar',
          data: isTimeBased
            ? costData.map((d) => Number(d.total_cost))
            : costData.map((d) => Number(d.total_cost)),
          itemStyle: { color: '#10b981' },
        },
      ],
    }
  }, [costData, groupBy])

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center gap-3">
        <Link
          href="/reports"
          className="p-2 rounded-lg hover:bg-muted transition-colors"
        >
          <ArrowLeft className="h-4 w-4" />
        </Link>
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Maintenance Costs</h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            Spare parts cost analysis with flexible grouping
          </p>
        </div>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap gap-3">
        <Select value={String(year)} onValueChange={(v) => setYear(Number(v))}>
          <SelectTrigger className="w-[130px]">
            <SelectValue placeholder="Year" />
          </SelectTrigger>
          <SelectContent>
            {YEAR_OPTIONS.map((y) => (
              <SelectItem key={y} value={String(y)}>
                {y}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Select value={groupBy} onValueChange={(v) => setGroupBy(v as MaintenanceCostGroupBy)}>
          <SelectTrigger className="w-[160px]">
            <SelectValue placeholder="Group by" />
          </SelectTrigger>
          <SelectContent>
            {GROUP_BY_OPTIONS.map((opt) => (
              <SelectItem key={opt.value} value={opt.value}>
                {opt.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Select value={locationId} onValueChange={setLocationId}>
          <SelectTrigger className="w-[200px]">
            <SelectValue placeholder="All locations" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All locations</SelectItem>
            {locations.map((loc) => (
              <SelectItem key={loc.id} value={loc.id}>
                {loc.location_name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Select value={fleetType} onValueChange={setFleetType}>
          <SelectTrigger className="w-[180px]">
            <SelectValue placeholder="All fleet types" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All fleet types</SelectItem>
            {fleetTypes.map((ft) => (
              <SelectItem key={ft.id} value={ft.name}>
                {ft.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {/* Grand Total */}
      {meta && (
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center gap-3">
              <div className="p-2.5 rounded-lg bg-emerald-100 dark:bg-emerald-900">
                <DollarSign className="h-5 w-5 text-emerald-600 dark:text-emerald-300" />
              </div>
              <div>
                <p className="text-xs text-muted-foreground uppercase tracking-wider">
                  Grand Total
                </p>
                <p className="text-2xl font-bold">
                  {formatNGN(Number(meta.grand_total))}
                </p>
                <p className="text-xs text-muted-foreground">
                  {meta.total_groups} group{meta.total_groups !== 1 ? 's' : ''}
                </p>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {isLoading ? (
        <div className="space-y-4">
          <Skeleton className="h-[300px] w-full" />
          <Skeleton className="h-[200px] w-full" />
        </div>
      ) : costData.length > 0 ? (
        <>
          {/* Chart */}
          {chartOption && (
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-base">
                  Cost Distribution ({GROUP_BY_OPTIONS.find((o) => o.value === groupBy)?.label})
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="w-full h-[300px]">
                  <ECharts
                    option={chartOption}
                    style={{ width: '100%', height: '100%' }}
                  />
                </div>
              </CardContent>
            </Card>
          )}

          {/* Table */}
          <Card>
            <CardContent className="pt-6">
              <div className="rounded-md border">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Period / Group</TableHead>
                      <TableHead className="text-right">Total Cost</TableHead>
                      <TableHead className="text-right">Parts Count</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {costData.map((row, i) => (
                      <TableRow key={i}>
                        <TableCell className="font-medium">
                          {String(row.period || '-')}
                        </TableCell>
                        <TableCell className="text-right font-mono">
                          {formatNGN(Number(row.total_cost))}
                        </TableCell>
                        <TableCell className="text-right font-mono">
                          {Number(row.parts_count).toLocaleString()}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            </CardContent>
          </Card>
        </>
      ) : (
        <Card>
          <CardContent className="py-12 text-center">
            <DollarSign className="h-10 w-10 mx-auto text-muted-foreground/50 mb-3" />
            <p className="font-medium">No cost data available</p>
            <p className="text-sm text-muted-foreground mt-1">
              Adjust filters or add spare parts data.
            </p>
          </CardContent>
        </Card>
      )}
    </div>
  )
}
