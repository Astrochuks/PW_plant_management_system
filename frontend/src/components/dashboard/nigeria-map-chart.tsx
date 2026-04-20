'use client'

import { useEffect, useRef, useState, useCallback, useMemo } from 'react'
import * as echarts from 'echarts'
import { useTheme } from 'next-themes'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { Badge } from '@/components/ui/badge'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { MapIcon, RotateCcw } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { useStatesSummary, useFleetSummary } from '@/hooks/use-dashboard'
import { useDashboardSummary } from '@/hooks/use-dashboard'
import type { StateSummary } from '@/lib/api/dashboard'

/**
 * Maps database state names to GeoJSON feature names.
 */
const DB_TO_GEO_NAME: Record<string, string> = {
  'FCT': 'Federal Capital Territory',
  'FCT-Abuja': 'Federal Capital Territory',
  'Abuja': 'Federal Capital Territory',
  'Nassarawa': 'Nasarawa',
}

function toGeoName(dbName: string): string {
  return DB_TO_GEO_NAME[dbName] || dbName
}

export function NigeriaMapChart() {
  const chartRef = useRef<HTMLDivElement>(null)
  const chartInstance = useRef<echarts.ECharts | null>(null)
  const { resolvedTheme } = useTheme()
  const [mounted, setMounted] = useState(false)
  const [mapRegistered, setMapRegistered] = useState(false)

  // Local filter state (lives on the map, not global)
  const [selectedFleetType, setSelectedFleetType] = useState<string | null>(null)
  const [selectedStateId, setSelectedStateId] = useState<string | null>(null)

  // Data hooks
  const { data: statesData, isLoading } = useStatesSummary(selectedFleetType ?? undefined)
  const { data: fleetTypes } = useFleetSummary()
  const { data: summary } = useDashboardSummary()

  // Get locations from summary to map site → state
  const locations = summary?.top_locations

  useEffect(() => {
    setMounted(true)
  }, [])

  // Register map data lazily
  useEffect(() => {
    if (!mounted) return
    let cancelled = false
    import('@/lib/map/nigeria-geojson').then((mod) => {
      if (cancelled) return
      echarts.registerMap('Nigeria', mod.default)
      setMapRegistered(true)
    })
    return () => { cancelled = true }
  }, [mounted])

  // Build lookup from GeoJSON name → state data
  const dataMap = useMemo(() => {
    if (!statesData) return new Map<string, StateSummary>()
    const map = new Map<string, StateSummary>()
    for (const s of statesData) {
      map.set(toGeoName(s.name), s)
    }
    return map
  }, [statesData])

  // Selected state info for the sidebar
  const selectedState = useMemo(() => {
    if (!selectedStateId || !statesData) return null
    return statesData.find((s) => s.id === selectedStateId) ?? null
  }, [selectedStateId, statesData])

  useEffect(() => {
    if (!chartRef.current || !mounted || !mapRegistered || !statesData) return

    if (!chartInstance.current) {
      chartInstance.current = echarts.init(chartRef.current)
    }

    const isDark = resolvedTheme === 'dark'

    // Find max for color scale (exclude zeros for better gradient)
    const plantsWithData = statesData.filter((s) => s.total_plants > 0)
    const maxPlants = Math.max(...plantsWithData.map((s) => s.total_plants), 1)

    // Build data array — include all states with data
    const mapData = statesData.map((s) => ({
      name: toGeoName(s.name),
      value: s.total_plants,
      selected: s.id === selectedStateId,
    }))

    // Build site list per state for tooltip
    const sitesByState = new Map<string, { name: string; plants: number }[]>()
    if (locations) {
      for (const loc of locations) {
        const stateName = loc.state_name || 'Unknown'
        const geoName = toGeoName(stateName)
        if (!sitesByState.has(geoName)) sitesByState.set(geoName, [])
        sitesByState.get(geoName)!.push({ name: loc.location_name, plants: loc.total_plants })
      }
    }

    const option: echarts.EChartsOption = {
      tooltip: {
        trigger: 'item',
        backgroundColor: isDark ? '#1a1d1e' : '#ffffff',
        borderColor: isDark ? '#2d3133' : '#e4e4e7',
        textStyle: { color: isDark ? '#fafafa' : '#101415', fontSize: 12 },
        formatter: (params: unknown) => {
          const p = params as { name: string; value: number }
          const state = dataMap.get(p.name)
          if (!state || state.total_plants === 0) return `<strong>${p.name}</strong><br/>No fleet data`

          const sites = sitesByState.get(p.name) || []
          const siteLines = sites
            .sort((a, b) => b.plants - a.plants)
            .slice(0, 8)
            .map(s => `&nbsp;&nbsp;• ${s.name}: <strong>${s.plants}</strong>`)
            .join('<br/>')

          return [
            `<strong style="font-size:13px">${p.name}</strong>`,
            `<span style="color:#10b981">Working: ${state.working_plants}</span> · <span style="color:#dc2626">B/Down: ${state.breakdown_plants}</span> · <span style="color:#3b82f6">Repair: ${state.under_repair_plants}</span>`,
            `<hr style="margin:4px 0;border-color:${isDark ? '#333' : '#e4e4e7'}"/>`,
            `<strong>${state.sites_count} site${state.sites_count > 1 ? 's' : ''} · ${state.total_plants} plants</strong>`,
            siteLines,
            sites.length > 8 ? `&nbsp;&nbsp;<em>+${sites.length - 8} more...</em>` : '',
          ].filter(Boolean).join('<br/>')
        },
        extraCssText: 'max-width:320px; white-space:normal;',
      },
      visualMap: {
        min: 0,
        max: maxPlants,
        text: [`${maxPlants} plants`, '0'],
        realtime: false,
        calculable: false,
        inRange: {
          color: isDark
            ? ['#1e293b', '#1e3a5f', '#2563eb', '#3b82f6', '#60a5fa']
            : ['#eff6ff', '#bfdbfe', '#60a5fa', '#2563eb', '#1d4ed8'],
        },
        textStyle: { color: isDark ? '#94a3b8' : '#64748b', fontSize: 11 },
        left: 16,
        bottom: 16,
        itemWidth: 14,
        itemHeight: 100,
      },
      series: [
        {
          name: 'Plants',
          type: 'map',
          map: 'Nigeria',
          roam: true,
          selectedMode: 'single',
          emphasis: {
            label: { show: true, fontSize: 12, fontWeight: 'bold', color: '#ffffff' },
            itemStyle: {
              areaColor: '#f59e0b',
              borderColor: '#ffffff',
              borderWidth: 2,
              shadowBlur: 10,
              shadowColor: 'rgba(0,0,0,0.3)',
            },
          },
          select: {
            label: { show: true, fontSize: 12, fontWeight: 'bold', color: '#ffffff' },
            itemStyle: {
              areaColor: '#f59e0b',
              borderColor: '#ffffff',
              borderWidth: 2,
            },
          },
          label: {
            show: true,
            fontSize: 10,
            color: isDark ? '#e2e8f0' : '#1e293b',
            fontWeight: 'bold',
            formatter: (params: unknown) => {
              const p = params as { name: string; value: number }
              if (!p.value || p.value === 0) return ''
              // Short state name + count
              const shortName = p.name.length > 12 ? p.name.slice(0, 10) + '..' : p.name
              return `${shortName}\n${p.value}`
            },
            lineHeight: 14,
          },
          itemStyle: {
            areaColor: isDark ? '#1e2024' : '#f1f5f9',
            borderColor: isDark ? '#475569' : '#94a3b8',
            borderWidth: 0.8,
          },
          data: mapData,
        },
      ],
    }

    chartInstance.current.setOption(option, true)

    // Click handler — select state
    chartInstance.current.off('click')
    chartInstance.current.on('click', (params: { name?: string }) => {
      if (!params.name) return
      const clicked = statesData.find((s) => toGeoName(s.name) === params.name)
      if (clicked) {
        setSelectedStateId((prev) => prev === clicked.id ? null : clicked.id)
      }
    })

    const handleResize = () => chartInstance.current?.resize()
    window.addEventListener('resize', handleResize)
    return () => window.removeEventListener('resize', handleResize)
  }, [statesData, resolvedTheme, mounted, mapRegistered, selectedStateId, dataMap])

  useEffect(() => {
    return () => {
      chartInstance.current?.dispose()
    }
  }, [])

  const hasFilters = selectedFleetType || selectedStateId

  return (
    <Card>
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between flex-wrap gap-2">
          <CardTitle className="text-base flex items-center gap-2">
            <MapIcon className="h-4 w-4" />
            Fleet Distribution by State
          </CardTitle>
          <div className="flex items-center gap-2">
            {/* Fleet type filter */}
            <Select
              value={selectedFleetType || '_all'}
              onValueChange={(v) => setSelectedFleetType(v === '_all' ? null : v)}
            >
              <SelectTrigger className="w-[150px] h-8 text-xs">
                <SelectValue placeholder="All Fleet Types" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="_all">All Fleet Types</SelectItem>
                {fleetTypes?.map((ft) => (
                  <SelectItem key={ft.fleet_type} value={ft.fleet_type}>
                    {ft.fleet_type}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {hasFilters && (
              <Button
                variant="ghost"
                size="sm"
                className="h-8 px-2 text-xs text-muted-foreground"
                onClick={() => { setSelectedFleetType(null); setSelectedStateId(null) }}
              >
                <RotateCcw className="h-3 w-3 mr-1" />
                Reset
              </Button>
            )}
          </div>
        </div>
        {selectedFleetType && (
          <p className="text-xs text-muted-foreground mt-1">
            Showing <span className="font-medium text-foreground">{selectedFleetType}</span> distribution
          </p>
        )}
      </CardHeader>
      <CardContent>
        <div className="flex gap-4">
          {/* Map */}
          <div className="flex-1 min-w-0">
            {isLoading || !mapRegistered ? (
              <Skeleton className="h-[550px] w-full" />
            ) : statesData && statesData.length > 0 ? (
              <div ref={chartRef} data-print-chart className="h-[550px] w-full" />
            ) : (
              <div className="h-[550px] flex items-center justify-center text-sm text-muted-foreground">
                No state data available
              </div>
            )}
          </div>

          {/* State detail sidebar */}
          {selectedState && (
            <div className="w-56 shrink-0 space-y-3 pt-2 border-l pl-4">
              <div>
                <h3 className="font-semibold text-sm">{selectedState.name}</h3>
                <p className="text-xs text-muted-foreground">{selectedState.code} · {selectedState.region || 'N/A'}</p>
              </div>
              <div className="space-y-1.5">
                <StatRow label="Total Plants" value={selectedState.total_plants} bold />
                <StatRow label="Working" value={selectedState.working_plants} color="text-emerald-600" />
                <StatRow label="Breakdown" value={selectedState.breakdown_plants} color="text-red-600" />
                <StatRow label="Under Repair" value={selectedState.under_repair_plants} color="text-blue-600" />
                <StatRow label="Missing" value={selectedState.missing_plants} color="text-orange-500" />
                <StatRow label="Scrap" value={selectedState.scrap_plants} color="text-gray-500" />
              </div>
              {/* Sites in this state */}
              {locations && (
                <div className="space-y-1">
                  <p className="text-[10px] font-medium text-muted-foreground uppercase tracking-wide">Sites</p>
                  <div className="space-y-1 max-h-[160px] overflow-y-auto">
                    {locations
                      .filter(l => l.state_name === selectedState.name)
                      .sort((a, b) => b.total_plants - a.total_plants)
                      .map(site => (
                        <div key={site.id} className="flex items-center justify-between text-xs">
                          <span className="truncate mr-2">{site.location_name}</span>
                          <Badge variant="secondary" className="text-[10px] px-1 py-0 shrink-0">{site.total_plants}</Badge>
                        </div>
                      ))
                    }
                  </div>
                </div>
              )}
              <Button
                variant="ghost"
                size="sm"
                className="w-full h-7 text-xs"
                onClick={() => setSelectedStateId(null)}
              >
                Clear selection
              </Button>
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  )
}

function StatRow({ label, value, color, bold }: {
  label: string
  value: number
  color?: string
  bold?: boolean
}) {
  return (
    <div className="flex items-center justify-between text-xs">
      <span className="text-muted-foreground">{label}</span>
      <span className={`${color || ''} ${bold ? 'font-semibold' : 'font-medium'}`}>
        {value.toLocaleString()}
      </span>
    </div>
  )
}
