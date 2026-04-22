'use client'

import { useEffect, useRef, useState } from 'react'
import * as echarts from 'echarts'
import { useTheme } from 'next-themes'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { TrendingUp } from 'lucide-react'
import { useMaintenanceCosts } from '@/hooks/use-reports'
import { useDashboardFilters } from '@/hooks/use-dashboard-filters'

function formatNGN(value: number): string {
  if (value >= 1_000_000_000) return `${(value / 1_000_000_000).toFixed(1)}B`
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`
  if (value >= 1_000) return `${(value / 1_000).toFixed(0)}K`
  return String(value)
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

export function CostTrendChart() {
  const chartRef = useRef<HTMLDivElement>(null)
  const chartInstance = useRef<echarts.ECharts | null>(null)
  const { resolvedTheme } = useTheme()
  const [mounted, setMounted] = useState(false)

  const { year, locationId, fleetType } = useDashboardFilters()

  const { data, isLoading } = useMaintenanceCosts({
    year,
    location_id: locationId ?? undefined,
    fleet_type: fleetType ?? undefined,
    group_by: 'month',
  })

  useEffect(() => {
    setMounted(true)
  }, [])

  useEffect(() => {
    if (!chartRef.current || !mounted || !data?.data) return

    if (!chartInstance.current) {
      chartInstance.current = echarts.init(chartRef.current)
    }

    const isDark = resolvedTheme === 'dark'

    // Map period values to month labels
    // group_key may be numeric ("1"-"12"), month name, or "YYYY-MM" format
    const MONTH_NAMES: Record<string, number> = {
      'january': 0, 'february': 1, 'march': 2, 'april': 3, 'may': 4, 'june': 5,
      'july': 6, 'august': 7, 'september': 8, 'october': 9, 'november': 10, 'december': 11,
      'jan': 0, 'feb': 1, 'mar': 2, 'apr': 3, 'jun': 5, 'jul': 6, 'aug': 7, 'sep': 8, 'oct': 9, 'nov': 10, 'dec': 11,
    }
    const values = new Array(12).fill(0)
    for (const item of data.data) {
      const p = item.period.trim()
      // Try numeric first ("1"-"12")
      const num = parseInt(p, 10)
      if (!isNaN(num) && num >= 1 && num <= 12) {
        values[num - 1] = item.total_cost
        continue
      }
      // Try month name
      const nameIdx = MONTH_NAMES[p.toLowerCase()]
      if (nameIdx !== undefined) {
        values[nameIdx] = item.total_cost
        continue
      }
      // Try "YYYY-MM" format
      const dashMatch = p.match(/\d{4}-(\d{1,2})/)
      if (dashMatch) {
        const mi = parseInt(dashMatch[1], 10) - 1
        if (mi >= 0 && mi < 12) values[mi] = item.total_cost
      }
    }

    const option: echarts.EChartsOption = {
      tooltip: {
        trigger: 'axis',
        backgroundColor: isDark ? '#1a1d1e' : '#ffffff',
        borderColor: isDark ? '#2d3133' : '#e4e4e7',
        textStyle: { color: isDark ? '#fafafa' : '#101415' },
        formatter: (params: unknown) => {
          const p = (params as { name: string; value: number }[])[0]
          return `${p.name}<br/>₦${Number(p.value).toLocaleString('en-NG')}`
        },
      },
      grid: {
        left: '3%',
        right: '4%',
        top: '8%',
        bottom: '8%',
        containLabel: true,
      },
      xAxis: {
        type: 'category',
        data: MONTHS,
        axisLabel: { color: isDark ? '#a1a1aa' : '#71717a', fontSize: 11 },
        axisLine: { lineStyle: { color: isDark ? '#2d3133' : '#e4e4e7' } },
      },
      yAxis: {
        type: 'value',
        axisLabel: {
          color: isDark ? '#a1a1aa' : '#71717a',
          fontSize: 11,
          formatter: (v: number) => `₦${formatNGN(v)}`,
        },
        splitLine: { lineStyle: { color: isDark ? '#1e2122' : '#f4f4f5' } },
      },
      series: [
        {
          type: 'line',
          data: values,
          smooth: true,
          symbol: 'circle',
          symbolSize: 6,
          lineStyle: { color: '#ffbf36', width: 2.5 },
          itemStyle: { color: '#ffbf36' },
          areaStyle: {
            color: new echarts.graphic.LinearGradient(0, 0, 0, 1, [
              { offset: 0, color: isDark ? 'rgba(255,191,54,0.3)' : 'rgba(255,191,54,0.2)' },
              { offset: 1, color: 'rgba(255,191,54,0)' },
            ]),
          },
        },
      ],
    }

    chartInstance.current.setOption(option, true)

    const handleResize = () => chartInstance.current?.resize()
    window.addEventListener('resize', handleResize)
    return () => window.removeEventListener('resize', handleResize)
  }, [data, resolvedTheme, mounted])

  useEffect(() => {
    return () => {
      chartInstance.current?.dispose()
    }
  }, [])

  const grandTotal = data?.meta?.grand_total ?? 0

  return (
    <Card>
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between">
          <CardTitle className="text-base flex items-center gap-2">
            <TrendingUp className="h-4 w-4" />
            Maintenance Cost Trend
          </CardTitle>
          {grandTotal > 0 && (
            <span className="text-sm font-semibold text-muted-foreground">
              YTD: ₦{grandTotal.toLocaleString('en-NG')}
            </span>
          )}
        </div>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <Skeleton className="h-[260px] w-full" />
        ) : data?.data && data.data.length > 0 ? (
          <div ref={chartRef} data-print-chart className="h-[260px] w-full" />
        ) : (
          <div className="h-[260px] flex items-center justify-center text-sm text-muted-foreground">
            No cost data for {year}
          </div>
        )}
      </CardContent>
    </Card>
  )
}
