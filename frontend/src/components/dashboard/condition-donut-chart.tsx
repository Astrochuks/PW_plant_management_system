'use client'

import { useEffect, useRef, useState } from 'react'
import * as echarts from 'echarts'
import { useTheme } from 'next-themes'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { Activity } from 'lucide-react'
import type { DashboardPlantStats } from '@/lib/api/dashboard'

const CONDITIONS = [
  { key: 'working_plants', label: 'Working', color: '#10b981' },
  { key: 'standby_plants', label: 'Standby', color: '#fbbf24' },
  { key: 'breakdown_plants', label: 'Breakdown', color: '#dc2626' },
  { key: 'missing_plants', label: 'Missing', color: '#ef4444' },
  { key: 'scrap_plants', label: 'Scrap', color: '#9ca3af' },
  { key: 'off_hire_plants', label: 'Off Hire', color: '#64748b' },
] as const

interface ConditionDonutChartProps {
  plants: DashboardPlantStats | undefined
  isLoading: boolean
}

export function ConditionDonutChart({ plants, isLoading }: ConditionDonutChartProps) {
  const chartRef = useRef<HTMLDivElement>(null)
  const chartInstance = useRef<echarts.ECharts | null>(null)
  const { resolvedTheme } = useTheme()
  const [mounted, setMounted] = useState(false)

  useEffect(() => {
    setMounted(true)
  }, [])

  useEffect(() => {
    if (!chartRef.current || !mounted || !plants) return

    if (!chartInstance.current) {
      chartInstance.current = echarts.init(chartRef.current)
    }

    const isDark = resolvedTheme === 'dark'

    const chartData = CONDITIONS
      .filter(({ key }) => (plants[key] ?? 0) > 0)
      .map(({ key, label, color }) => ({
        name: label,
        value: plants[key] ?? 0,
        itemStyle: { color },
      }))

    const option: echarts.EChartsOption = {
      tooltip: {
        trigger: 'item',
        formatter: '{b}: {c} ({d}%)',
        backgroundColor: isDark ? '#1a1d1e' : '#ffffff',
        borderColor: isDark ? '#2d3133' : '#e4e4e7',
        textStyle: { color: isDark ? '#fafafa' : '#101415' },
      },
      legend: {
        orient: 'horizontal',
        bottom: 0,
        left: 'center',
        textStyle: {
          color: isDark ? '#a1a1aa' : '#71717a',
          fontSize: 11,
        },
        itemWidth: 10,
        itemHeight: 10,
        itemGap: 12,
      },
      series: [
        {
          type: 'pie',
          radius: ['42%', '68%'],
          center: ['50%', '42%'],
          avoidLabelOverlap: false,
          itemStyle: {
            borderRadius: 4,
            borderColor: isDark ? '#101415' : '#ffffff',
            borderWidth: 2,
          },
          label: { show: false },
          emphasis: {
            label: { show: true, fontSize: 13, fontWeight: 'bold' },
            itemStyle: {
              shadowBlur: 10,
              shadowOffsetX: 0,
              shadowColor: 'rgba(0, 0, 0, 0.2)',
            },
          },
          data: chartData,
        },
      ],
      graphic: [
        {
          type: 'text',
          left: 'center',
          top: '37%',
          style: {
            text: String(plants.total_plants ?? 0),
            fontSize: 22,
            fontWeight: 'bold',
            fill: isDark ? '#fafafa' : '#101415',
            textAlign: 'center',
          } as Record<string, unknown>,
        },
        {
          type: 'text',
          left: 'center',
          top: '46%',
          style: {
            text: 'Total',
            fontSize: 11,
            fill: isDark ? '#a1a1aa' : '#71717a',
            textAlign: 'center',
          } as Record<string, unknown>,
        },
      ],
    }

    chartInstance.current.setOption(option, true)

    const handleResize = () => chartInstance.current?.resize()
    window.addEventListener('resize', handleResize)
    return () => window.removeEventListener('resize', handleResize)
  }, [plants, resolvedTheme, mounted])

  useEffect(() => {
    return () => {
      chartInstance.current?.dispose()
    }
  }, [])

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-base flex items-center gap-2">
          <Activity className="h-4 w-4" />
          Fleet Condition
        </CardTitle>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <Skeleton className="h-[320px] w-full" />
        ) : plants ? (
          <div ref={chartRef} data-print-chart className="h-[320px] w-full" />
        ) : (
          <div className="h-[320px] flex items-center justify-center text-sm text-muted-foreground">
            No data available
          </div>
        )}
      </CardContent>
    </Card>
  )
}
