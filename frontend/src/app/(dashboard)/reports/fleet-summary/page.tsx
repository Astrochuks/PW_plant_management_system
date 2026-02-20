'use client'

import { useMemo, useState } from 'react'
import Link from 'next/link'
import ECharts from 'echarts-for-react'
import { ArrowLeft, Truck } from 'lucide-react'
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
import { useFleetSummary } from '@/hooks/use-reports'
import { useLocationsWithStats } from '@/hooks/use-locations'

export default function FleetSummaryPage() {
  const [locationId, setLocationId] = useState<string>('')
  const { data: locations = [] } = useLocationsWithStats()

  const params = useMemo(
    () => (locationId ? { location_id: locationId } : {}),
    [locationId]
  )
  const { data, isLoading } = useFleetSummary(params)

  const chartOption = useMemo(() => {
    if (!data || data.length === 0) return null

    const types = data.map((d) => d.fleet_type || 'Unknown')
    return {
      tooltip: {
        trigger: 'axis',
        axisPointer: { type: 'shadow' },
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
        data: types,
        axisLabel: { fontSize: 11, rotate: types.length > 8 ? 30 : 0 },
      },
      yAxis: {
        type: 'value',
        name: 'Count',
        nameTextStyle: { fontSize: 11 },
      },
      series: [
        {
          name: 'Working',
          type: 'bar',
          stack: 'condition',
          data: data.map((d) => Number(d.working)),
          itemStyle: { color: '#10b981' },
        },
        {
          name: 'Standby',
          type: 'bar',
          stack: 'condition',
          data: data.map((d) => Number(d.standby)),
          itemStyle: { color: '#f59e0b' },
        },
        {
          name: 'Breakdown',
          type: 'bar',
          stack: 'condition',
          data: data.map((d) => Number(d.breakdown)),
          itemStyle: { color: '#ef4444' },
        },
      ],
    }
  }, [data])

  const total = useMemo(
    () => (data ? data.reduce((s, d) => s + Number(d.total), 0) : 0),
    [data]
  )

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Link
            href="/reports"
            className="p-2 rounded-lg hover:bg-muted transition-colors"
          >
            <ArrowLeft className="h-4 w-4" />
          </Link>
          <div>
            <h1 className="text-2xl font-bold tracking-tight">Fleet Summary</h1>
            <p className="text-sm text-muted-foreground mt-0.5">
              Fleet breakdown by equipment type
            </p>
          </div>
        </div>
        <Select value={locationId} onValueChange={setLocationId}>
          <SelectTrigger className="w-[220px]">
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

      {isLoading ? (
        <div className="space-y-4">
          <Skeleton className="h-[300px] w-full" />
          <Skeleton className="h-[200px] w-full" />
        </div>
      ) : data && data.length > 0 ? (
        <>
          {/* Chart */}
          {chartOption && (
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-base flex items-center gap-2">
                  <Truck className="h-4 w-4" />
                  Fleet by Type ({total.toLocaleString()} total)
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
                      <TableHead>Fleet Type</TableHead>
                      <TableHead className="text-right">Total</TableHead>
                      <TableHead className="text-right">Working</TableHead>
                      <TableHead className="text-right">Standby</TableHead>
                      <TableHead className="text-right">Breakdown</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {data.map((row) => (
                      <TableRow key={row.fleet_type}>
                        <TableCell className="font-medium">
                          {row.fleet_type || 'Unknown'}
                        </TableCell>
                        <TableCell className="text-right font-mono">
                          {Number(row.total).toLocaleString()}
                        </TableCell>
                        <TableCell className="text-right font-mono text-emerald-600 dark:text-emerald-400">
                          {Number(row.working).toLocaleString()}
                        </TableCell>
                        <TableCell className="text-right font-mono text-amber-600 dark:text-amber-400">
                          {Number(row.standby).toLocaleString()}
                        </TableCell>
                        <TableCell className="text-right font-mono">
                          {Number(row.breakdown) > 0 ? (
                            <span className="text-red-600 dark:text-red-400">
                              {Number(row.breakdown).toLocaleString()}
                            </span>
                          ) : (
                            <span className="text-muted-foreground">0</span>
                          )}
                        </TableCell>
                      </TableRow>
                    ))}
                    {/* Totals row */}
                    <TableRow className="bg-muted/50 font-bold">
                      <TableCell>Total</TableCell>
                      <TableCell className="text-right font-mono">
                        {data.reduce((s, d) => s + Number(d.total), 0).toLocaleString()}
                      </TableCell>
                      <TableCell className="text-right font-mono text-emerald-600 dark:text-emerald-400">
                        {data.reduce((s, d) => s + Number(d.working), 0).toLocaleString()}
                      </TableCell>
                      <TableCell className="text-right font-mono text-amber-600 dark:text-amber-400">
                        {data.reduce((s, d) => s + Number(d.standby), 0).toLocaleString()}
                      </TableCell>
                      <TableCell className="text-right font-mono text-red-600 dark:text-red-400">
                        {data.reduce((s, d) => s + Number(d.breakdown), 0).toLocaleString()}
                      </TableCell>
                    </TableRow>
                  </TableBody>
                </Table>
              </div>
            </CardContent>
          </Card>
        </>
      ) : (
        <Card>
          <CardContent className="py-12 text-center">
            <Truck className="h-10 w-10 mx-auto text-muted-foreground/50 mb-3" />
            <p className="font-medium">No fleet data available</p>
            <p className="text-sm text-muted-foreground mt-1">
              Fleet summary will appear once plant data is loaded.
            </p>
          </CardContent>
        </Card>
      )}
    </div>
  )
}
