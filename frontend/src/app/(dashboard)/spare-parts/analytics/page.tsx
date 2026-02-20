'use client'

import { useMemo, useState } from 'react'
import Link from 'next/link'
import ECharts from 'echarts-for-react'
import { ArrowLeft, DollarSign, Truck, Building2, FileText } from 'lucide-react'
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
import {
  useSparePartsSummary,
  useCostsByPeriod,
  useYearOverYear,
  useTopSuppliers,
  useHighCostPlants,
} from '@/hooks/use-spare-parts'
import { useLocationsWithStats } from '@/hooks/use-locations'

const currentYear = new Date().getFullYear()
const YEAR_OPTIONS = Array.from({ length: 5 }, (_, i) => currentYear - i)

const MONTH_LABELS = [
  '', 'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
  'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
]

function formatNGN(amount: number): string {
  return new Intl.NumberFormat('en-NG', {
    style: 'currency',
    currency: 'NGN',
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(amount)
}

function formatCompact(amount: number): string {
  if (amount >= 1_000_000) return `\u20A6${(amount / 1_000_000).toFixed(1)}M`
  if (amount >= 1_000) return `\u20A6${(amount / 1_000).toFixed(0)}K`
  return formatNGN(amount)
}

export default function SparePartsAnalyticsPage() {
  const [year, setYear] = useState<number>(currentYear)
  const [locationId, setLocationId] = useState<string>('')

  const { data: locations = [] } = useLocationsWithStats()

  const summaryParams = useMemo(() => ({
    year,
    ...(locationId && locationId !== 'all' ? { location_id: locationId } : {}),
  }), [year, locationId])

  const { data: summary, isLoading: summaryLoading } = useSparePartsSummary(summaryParams)
  const { data: costsByMonth, isLoading: costsLoading } = useCostsByPeriod({
    period: 'month',
    year,
    ...(locationId && locationId !== 'all' ? { location_id: locationId } : {}),
  })
  const { data: yoyData, isLoading: yoyLoading } = useYearOverYear({
    years: [year - 1, year],
    group_by: 'month',
    ...(locationId && locationId !== 'all' ? { location_id: locationId } : {}),
  })
  const { data: topSuppliers, isLoading: suppliersLoading } = useTopSuppliers({
    year,
    limit: 10,
    ...(locationId && locationId !== 'all' ? { location_id: locationId } : {}),
  })
  const { data: highCostPlants, isLoading: plantsLoading } = useHighCostPlants({
    year,
    limit: 10,
  })

  // Cost Trend chart option
  const costTrendOption = useMemo(() => {
    if (!costsByMonth?.data.length) return null
    return {
      tooltip: {
        trigger: 'axis',
        formatter: (params: unknown[]) => {
          const p = params as Array<{ name: string; value: number; marker: string; seriesName: string }>
          let html = `<strong>${p[0]?.name}</strong>`
          p.forEach((item) => {
            html += `<br/>${item.marker} ${item.seriesName}: <strong>${formatNGN(Number(item.value))}</strong>`
          })
          return html
        },
      },
      grid: { left: '3%', right: '4%', bottom: '40px', top: '12px', containLabel: true },
      xAxis: {
        type: 'category' as const,
        data: costsByMonth.data.map((d) => MONTH_LABELS[d.period] || `M${d.period}`),
        axisLabel: { fontSize: 11 },
      },
      yAxis: {
        type: 'value' as const,
        axisLabel: { fontSize: 11, formatter: (v: number) => formatCompact(v) },
      },
      series: [
        {
          name: 'Total Cost',
          type: 'bar',
          data: costsByMonth.data.map((d) => d.total_cost),
          itemStyle: { color: '#10b981' },
        },
        {
          name: 'Items',
          type: 'line',
          yAxisIndex: 0,
          data: costsByMonth.data.map((d) => d.items_count),
          itemStyle: { color: '#6366f1' },
          lineStyle: { type: 'dashed' },
          symbol: 'circle',
          symbolSize: 6,
          show: false, // hide this series — only cost bar
        },
      ],
    }
  }, [costsByMonth])

  // Year-over-Year chart option
  const yoyOption = useMemo(() => {
    if (!yoyData?.data.length) return null
    const years = yoyData.meta.years
    return {
      tooltip: {
        trigger: 'axis',
        formatter: (params: unknown[]) => {
          const p = params as Array<{ name: string; value: number; marker: string; seriesName: string }>
          let html = `<strong>${p[0]?.name}</strong>`
          p.forEach((item) => {
            html += `<br/>${item.marker} ${item.seriesName}: <strong>${formatNGN(Number(item.value))}</strong>`
          })
          return html
        },
      },
      legend: { top: 0, data: years.map(String) },
      grid: { left: '3%', right: '4%', bottom: '40px', top: '36px', containLabel: true },
      xAxis: {
        type: 'category' as const,
        data: yoyData.data.map((d) => MONTH_LABELS[Number(d.month)] || `M${d.month}`),
        axisLabel: { fontSize: 11 },
      },
      yAxis: {
        type: 'value' as const,
        axisLabel: { fontSize: 11, formatter: (v: number) => formatCompact(v) },
      },
      series: years.map((yr, idx) => ({
        name: String(yr),
        type: 'bar',
        data: yoyData.data.map((d) => Number(d[String(yr)] ?? 0)),
        itemStyle: { color: idx === 0 ? '#94a3b8' : '#10b981' },
      })),
    }
  }, [yoyData])

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center gap-3">
        <Link
          href="/spare-parts"
          className="p-2 rounded-lg hover:bg-muted transition-colors"
        >
          <ArrowLeft className="h-4 w-4" />
        </Link>
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Spare Parts Analytics</h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            Cost trends, supplier analysis, and high-cost plants
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
              <SelectItem key={y} value={String(y)}>{y}</SelectItem>
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
              <SelectItem key={loc.id} value={loc.id}>{loc.location_name}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {/* Summary Cards */}
      {summaryLoading ? (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {[...Array(4)].map((_, i) => <Skeleton key={i} className="h-[80px]" />)}
        </div>
      ) : summary ? (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <Card>
            <CardContent className="pt-6">
              <div className="flex items-center gap-3">
                <div className="p-2 rounded-lg bg-emerald-100">
                  <DollarSign className="h-4 w-4 text-emerald-600" />
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">Total Cost</p>
                  <p className="text-xl font-bold">{formatCompact(summary.total_cost)}</p>
                </div>
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-6">
              <div className="flex items-center gap-3">
                <div className="p-2 rounded-lg bg-blue-100">
                  <FileText className="h-4 w-4 text-blue-600" />
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">Total Parts</p>
                  <p className="text-xl font-bold">{summary.total_parts.toLocaleString()}</p>
                </div>
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-6">
              <div className="flex items-center gap-3">
                <div className="p-2 rounded-lg bg-violet-100">
                  <FileText className="h-4 w-4 text-violet-600" />
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">Purchase Orders</p>
                  <p className="text-xl font-bold">{summary.total_pos.toLocaleString()}</p>
                </div>
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-6">
              <div className="flex items-center gap-3">
                <div className="p-2 rounded-lg bg-amber-100">
                  <DollarSign className="h-4 w-4 text-amber-600" />
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">Direct Cost</p>
                  <p className="text-xl font-bold">{formatCompact(summary.direct_cost)}</p>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>
      ) : null}

      {/* Cost Trend Chart */}
      {costsLoading ? (
        <Skeleton className="h-[350px] w-full" />
      ) : costTrendOption ? (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Monthly Cost Trend — {year}</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="w-full h-[300px]">
              <ECharts option={costTrendOption} style={{ width: '100%', height: '100%' }} />
            </div>
          </CardContent>
        </Card>
      ) : null}

      {/* Year-over-Year Chart */}
      {yoyLoading ? (
        <Skeleton className="h-[350px] w-full" />
      ) : yoyOption ? (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">
              Year-over-Year Comparison — {year - 1} vs {year}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="w-full h-[300px]">
              <ECharts option={yoyOption} style={{ width: '100%', height: '100%' }} />
            </div>
            {yoyData?.meta.yearly_totals && (
              <div className="flex gap-6 mt-4 text-sm">
                {Object.entries(yoyData.meta.yearly_totals).map(([yr, total]) => (
                  <div key={yr}>
                    <span className="text-muted-foreground">{yr} Total: </span>
                    <span className="font-medium">{formatNGN(Number(total))}</span>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      ) : null}

      {/* Two-column layout: Top Suppliers + High Cost Plants */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Top Suppliers */}
        {suppliersLoading ? (
          <Skeleton className="h-[400px]" />
        ) : topSuppliers && topSuppliers.length > 0 ? (
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base flex items-center gap-2">
                <Building2 className="h-4 w-4" />
                Top Suppliers
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="rounded-md border">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>#</TableHead>
                      <TableHead>Supplier</TableHead>
                      <TableHead className="text-right">Spend</TableHead>
                      <TableHead className="text-right">Parts</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {topSuppliers.map((s, i) => (
                      <TableRow key={i}>
                        <TableCell className="text-xs text-muted-foreground">{i + 1}</TableCell>
                        <TableCell className="font-medium text-sm">{s.supplier}</TableCell>
                        <TableCell className="text-right font-mono text-sm">
                          {formatCompact(s.total_spend)}
                        </TableCell>
                        <TableCell className="text-right font-mono text-sm">
                          {s.parts_count}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            </CardContent>
          </Card>
        ) : (
          <Card>
            <CardContent className="py-8 text-center">
              <Building2 className="h-8 w-8 mx-auto text-muted-foreground/50 mb-2" />
              <p className="text-sm text-muted-foreground">No supplier data</p>
            </CardContent>
          </Card>
        )}

        {/* High Cost Plants */}
        {plantsLoading ? (
          <Skeleton className="h-[400px]" />
        ) : highCostPlants && highCostPlants.length > 0 ? (
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base flex items-center gap-2">
                <Truck className="h-4 w-4" />
                Highest Cost Plants
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="rounded-md border">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>#</TableHead>
                      <TableHead>Fleet #</TableHead>
                      <TableHead className="text-right">Cost</TableHead>
                      <TableHead className="text-right">Parts</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {highCostPlants.map((p, i) => (
                      <TableRow key={p.plant_id}>
                        <TableCell className="text-xs text-muted-foreground">{i + 1}</TableCell>
                        <TableCell className="font-mono font-medium">
                          <Link
                            href={`/plants/${p.plant_id}`}
                            className="text-primary hover:underline"
                          >
                            {p.fleet_number}
                          </Link>
                          {p.description && (
                            <span className="block text-[11px] text-muted-foreground truncate max-w-[150px]">
                              {p.description}
                            </span>
                          )}
                        </TableCell>
                        <TableCell className="text-right font-mono text-sm">
                          {formatCompact(p.total_cost)}
                        </TableCell>
                        <TableCell className="text-right font-mono text-sm">
                          {p.parts_count}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            </CardContent>
          </Card>
        ) : (
          <Card>
            <CardContent className="py-8 text-center">
              <Truck className="h-8 w-8 mx-auto text-muted-foreground/50 mb-2" />
              <p className="text-sm text-muted-foreground">No plant cost data</p>
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  )
}
