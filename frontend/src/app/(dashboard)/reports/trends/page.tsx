'use client'

import { useMemo, useState } from 'react'
import Link from 'next/link'
import ECharts from 'echarts-for-react'
import { ArrowLeft, TrendingUp, ArrowRightLeft } from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { Separator } from '@/components/ui/separator'
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
import { Input } from '@/components/ui/input'
import { useWeeklyTrend, usePlantMovement } from '@/hooks/use-reports'
import { useLocationsWithStats } from '@/hooks/use-locations'
import { useFleetTypes } from '@/hooks/use-plants'

const currentYear = new Date().getFullYear()
const YEAR_OPTIONS = Array.from({ length: 5 }, (_, i) => currentYear - i)

export default function TrendsPage() {
  // Weekly trend state
  const [trendYear, setTrendYear] = useState<number>(currentYear)
  const [trendLocation, setTrendLocation] = useState<string>('')

  // Plant movement state
  const [dateFrom, setDateFrom] = useState<string>('')
  const [dateTo, setDateTo] = useState<string>('')
  const [moveFleetType, setMoveFleetType] = useState<string>('')

  const { data: locations = [] } = useLocationsWithStats()
  const { data: fleetTypes = [] } = useFleetTypes()

  const trendParams = useMemo(
    () => ({
      year: trendYear,
      ...(trendLocation ? { location_id: trendLocation } : {}),
    }),
    [trendYear, trendLocation]
  )
  const { data: trendData, isLoading: trendLoading } = useWeeklyTrend(trendParams)

  const moveParams = useMemo(() => {
    const p: { date_from?: string; date_to?: string; fleet_type?: string } = {}
    if (dateFrom) p.date_from = dateFrom
    if (dateTo) p.date_to = dateTo
    if (moveFleetType) p.fleet_type = moveFleetType
    return p
  }, [dateFrom, dateTo, moveFleetType])
  const { data: moveData, isLoading: moveLoading } = usePlantMovement(moveParams)

  // Weekly trend chart
  const trendChartOption = useMemo(() => {
    if (!trendData || trendData.length === 0) return null

    const weeks = trendData.map((d) => `W${d.week_number}`)
    return {
      tooltip: {
        trigger: 'axis',
      },
      legend: {
        data: ['Plant Count', 'Verification Rate'],
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
        data: weeks,
        axisLabel: { fontSize: 11, rotate: weeks.length > 20 ? 45 : 0 },
      },
      yAxis: [
        {
          type: 'value',
          name: 'Plants',
          nameTextStyle: { fontSize: 11 },
          position: 'left',
        },
        {
          type: 'value',
          name: 'Rate %',
          nameTextStyle: { fontSize: 11 },
          position: 'right',
          min: 0,
          max: 100,
          axisLabel: { formatter: '{value}%' },
        },
      ],
      series: [
        {
          name: 'Plant Count',
          type: 'bar',
          data: trendData.map((d) => Number(d.plant_count)),
          itemStyle: { color: '#3b82f6' },
        },
        {
          name: 'Verification Rate',
          type: 'line',
          yAxisIndex: 1,
          data: trendData.map((d) => Number(d.verification_rate)),
          itemStyle: { color: '#10b981' },
          lineStyle: { width: 2 },
          smooth: true,
        },
      ],
    }
  }, [trendData])

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
          <h1 className="text-2xl font-bold tracking-tight">
            Weekly Trends & Plant Movement
          </h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            Track fleet trends and transfer history
          </p>
        </div>
      </div>

      {/* ===== Weekly Trend Section ===== */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <TrendingUp className="h-4 w-4" />
            Weekly Trend
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {/* Trend Filters */}
          <div className="flex flex-wrap gap-3">
            <Select
              value={String(trendYear)}
              onValueChange={(v) => setTrendYear(Number(v))}
            >
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

            <Select value={trendLocation} onValueChange={setTrendLocation}>
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
          </div>

          {trendLoading ? (
            <Skeleton className="h-[300px] w-full" />
          ) : trendChartOption ? (
            <div className="w-full h-[300px]">
              <ECharts
                option={trendChartOption}
                style={{ width: '100%', height: '100%' }}
              />
            </div>
          ) : (
            <div className="py-8 text-center text-sm text-muted-foreground">
              No trend data for {trendYear}
            </div>
          )}
        </CardContent>
      </Card>

      <Separator />

      {/* ===== Plant Movement Section ===== */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <ArrowRightLeft className="h-4 w-4" />
            Plant Movement
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {/* Movement Filters */}
          <div className="flex flex-wrap gap-3 items-end">
            <div>
              <label className="text-xs text-muted-foreground mb-1 block">From</label>
              <Input
                type="date"
                value={dateFrom}
                onChange={(e) => setDateFrom(e.target.value)}
                className="w-[160px]"
              />
            </div>
            <div>
              <label className="text-xs text-muted-foreground mb-1 block">To</label>
              <Input
                type="date"
                value={dateTo}
                onChange={(e) => setDateTo(e.target.value)}
                className="w-[160px]"
              />
            </div>
            <Select value={moveFleetType} onValueChange={setMoveFleetType}>
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

          {moveLoading ? (
            <Skeleton className="h-[200px] w-full" />
          ) : moveData && moveData.length > 0 ? (
            <div className="rounded-md border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Fleet #</TableHead>
                    <TableHead>From</TableHead>
                    <TableHead>To</TableHead>
                    <TableHead>Date</TableHead>
                    <TableHead>By</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {moveData.map((row, i) => (
                    <TableRow key={i}>
                      <TableCell className="font-mono font-medium">
                        <Link
                          href={`/plants/${row.plant_id}`}
                          className="text-primary hover:underline"
                        >
                          {row.fleet_number}
                        </Link>
                      </TableCell>
                      <TableCell>{row.from_location || '-'}</TableCell>
                      <TableCell>{row.to_location || '-'}</TableCell>
                      <TableCell className="text-sm text-muted-foreground">
                        {row.transfer_date
                          ? new Date(row.transfer_date).toLocaleDateString(
                              'en-NG',
                              { day: 'numeric', month: 'short', year: 'numeric' }
                            )
                          : '-'}
                      </TableCell>
                      <TableCell className="text-sm text-muted-foreground">
                        {row.transferred_by || '-'}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          ) : (
            <div className="py-8 text-center text-sm text-muted-foreground">
              No plant movements found for the selected filters
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
