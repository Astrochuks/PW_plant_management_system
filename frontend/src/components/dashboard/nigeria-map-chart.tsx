'use client'

import { useEffect, useRef, useState, useMemo, useCallback } from 'react'
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
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table'
import { MapIcon, RotateCcw, Download } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { useStatesSummary, useFleetSummary, useFleetDistribution } from '@/hooks/use-dashboard'
import type { StateSummary, FleetDistState } from '@/lib/api/dashboard'

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

  const [selectedFleetType, setSelectedFleetType] = useState<string | null>(null)
  const [selectedStateId, setSelectedStateId] = useState<string | null>(null)

  const { data: statesData, isLoading } = useStatesSummary(selectedFleetType ?? undefined)
  const { data: fleetTypes } = useFleetSummary()
  const { data: distData } = useFleetDistribution(selectedFleetType ?? undefined)

  useEffect(() => { setMounted(true) }, [])

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

  const dataMap = useMemo(() => {
    if (!statesData) return new Map<string, StateSummary>()
    const map = new Map<string, StateSummary>()
    for (const s of statesData) {
      map.set(toGeoName(s.name), s)
    }
    return map
  }, [statesData])

  // Build site labels from fleet distribution data (respects fleet_type filter)
  const sitesByState = useMemo(() => {
    if (!distData) return new Map<string, { name: string; plants: number }[]>()
    const map = new Map<string, { name: string; plants: number }[]>()
    for (const state of distData) {
      const geoName = toGeoName(state.state_name)
      const sites = state.sites
        .filter(s => s.total_plants > 0)
        .map(s => ({ name: s.site_name, plants: s.total_plants }))
      if (sites.length > 0) map.set(geoName, sites)
    }
    return map
  }, [distData])

  // Collect all fleet types across the distribution data for table headers
  const allFleetTypeNames = useMemo(() => {
    if (!distData) return []
    const set = new Set<string>()
    for (const state of distData) {
      for (const site of state.sites) {
        for (const ft of Object.keys(site.fleet_types)) {
          set.add(ft)
        }
      }
    }
    return Array.from(set).sort()
  }, [distData])

  // Export CSV
  const handleExport = useCallback(() => {
    if (!distData) return
    const ftCols = allFleetTypeNames
    const header = ['State', 'State Code', 'Region', 'Site', 'Total Plants', ...ftCols]
    const rows: string[][] = []
    for (const state of distData) {
      for (const site of state.sites) {
        rows.push([
          state.state_name,
          state.state_code,
          state.region || '',
          site.site_name,
          String(site.total_plants),
          ...ftCols.map(ft => String(site.fleet_types[ft] || 0)),
        ])
      }
    }
    const csv = [header, ...rows].map(r => r.map(c => `"${c}"`).join(',')).join('\n')
    const blob = new Blob([csv], { type: 'text/csv' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `fleet-distribution${selectedFleetType ? `-${selectedFleetType}` : ''}.csv`
    a.click()
    URL.revokeObjectURL(url)
  }, [distData, allFleetTypeNames, selectedFleetType])

  useEffect(() => {
    if (!chartRef.current || !mounted || !mapRegistered || !statesData) return

    if (!chartInstance.current) {
      chartInstance.current = echarts.init(chartRef.current)
    }

    const isDark = resolvedTheme === 'dark'
    const plantsWithData = statesData.filter((s) => s.total_plants > 0)
    const maxPlants = Math.max(...plantsWithData.map((s) => s.total_plants), 1)

    const mapData = statesData.map((s) => ({
      name: toGeoName(s.name),
      value: s.total_plants,
      selected: s.id === selectedStateId,
    }))

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
            .slice(0, 10)
            .map(s => `&nbsp;&nbsp;• ${s.name}: <strong>${s.plants}</strong>`)
            .join('<br/>')

          return [
            `<strong style="font-size:13px">${p.name}</strong>`,
            `<span style="color:#10b981">Working: ${state.working_plants}</span> · <span style="color:#dc2626">B/Down: ${state.breakdown_plants}</span> · <span style="color:#3b82f6">Standby: ${state.standby_plants}</span>`,
            `<hr style="margin:4px 0;border-color:${isDark ? '#333' : '#e4e4e7'}"/>`,
            `<strong>${state.sites_count} site${state.sites_count > 1 ? 's' : ''} · ${state.total_plants} plants</strong>`,
            siteLines,
            sites.length > 10 ? `&nbsp;&nbsp;<em>+${sites.length - 10} more...</em>` : '',
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
          roam: 'move',
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
            fontSize: 9,
            color: isDark ? '#e2e8f0' : '#1e293b',
            formatter: (params: unknown) => {
              const p = params as { name: string; value: number }
              if (!p.value || p.value === 0) return ''

              const sites = sitesByState.get(p.name) || []
              if (sites.length === 0) return ''

              const lines: string[] = [`{title|${p.name}}`]
              const maxSites = sites.length > 5 ? 3 : 4
              for (let i = 0; i < Math.min(sites.length, maxSites); i++) {
                const s = sites[i]
                const shortName = s.name.length > 16 ? s.name.slice(0, 14) + '..' : s.name
                lines.push(`{site|${shortName}} {count|${s.plants}}`)
              }
              if (sites.length > maxSites) {
                lines.push(`{more|+${sites.length - maxSites} more}`)
              }

              return lines.join('\n')
            },
            rich: {
              title: {
                fontSize: 10,
                fontWeight: 'bold',
                color: isDark ? '#f1f5f9' : '#0f172a',
                lineHeight: 14,
                padding: [0, 0, 2, 0],
              },
              site: {
                fontSize: 8,
                color: isDark ? '#94a3b8' : '#475569',
                lineHeight: 12,
              },
              count: {
                fontSize: 8,
                fontWeight: 'bold',
                color: isDark ? '#60a5fa' : '#2563eb',
                lineHeight: 12,
              },
              more: {
                fontSize: 7,
                color: isDark ? '#64748b' : '#94a3b8',
                fontStyle: 'italic',
                lineHeight: 11,
              },
            },
            lineHeight: 12,
            overflow: 'none',
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
  }, [statesData, resolvedTheme, mounted, mapRegistered, selectedStateId, dataMap, sitesByState])

  useEffect(() => {
    return () => { chartInstance.current?.dispose() }
  }, [])

  const hasFilters = selectedFleetType || selectedStateId

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader className="pb-2">
          <div className="flex items-center justify-between flex-wrap gap-2">
            <CardTitle className="text-base flex items-center gap-2">
              <MapIcon className="h-4 w-4" />
              Fleet Distribution by State
            </CardTitle>
            <div className="flex items-center gap-2">
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
          {isLoading || !mapRegistered ? (
            <Skeleton className="h-[1000px] w-full" />
          ) : statesData && statesData.length > 0 ? (
            <div ref={chartRef} data-print-chart className="h-[1000px] w-full" />
          ) : (
            <div className="h-[1000px] flex items-center justify-center text-sm text-muted-foreground">
              No state data available
            </div>
          )}
        </CardContent>
      </Card>

      {/* Fleet Distribution Table */}
      {distData && distData.length > 0 && (
        <Card>
          <CardHeader className="pb-2">
            <div className="flex items-center justify-between flex-wrap gap-2">
              <CardTitle className="text-base">
                Fleet Distribution Breakdown
                {selectedFleetType && (
                  <span className="text-sm font-normal text-muted-foreground ml-2">
                    — {selectedFleetType}
                  </span>
                )}
              </CardTitle>
              <Button variant="outline" size="sm" onClick={handleExport}>
                <Download className="h-4 w-4 mr-2" />
                Export CSV
              </Button>
            </div>
          </CardHeader>
          <CardContent>
            <div className="border rounded-lg overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-[40px]">#</TableHead>
                    <TableHead className="min-w-[120px]">State</TableHead>
                    <TableHead className="min-w-[150px]">Site</TableHead>
                    <TableHead className="w-[80px] text-center">Total</TableHead>
                    {allFleetTypeNames.map(ft => (
                      <TableHead key={ft} className="text-center whitespace-nowrap text-xs">
                        {ft}
                      </TableHead>
                    ))}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {distData.flatMap((state, si) =>
                    state.sites.map((site, siteIdx) => (
                      <TableRow key={`${state.state_name}-${site.site_name}`} className="text-sm">
                        {siteIdx === 0 ? (
                          <>
                            <TableCell
                              rowSpan={state.sites.length}
                              className="text-xs text-muted-foreground align-top font-medium"
                            >
                              {si + 1}
                            </TableCell>
                            <TableCell
                              rowSpan={state.sites.length}
                              className="font-semibold align-top"
                            >
                              <div>{state.state_name}</div>
                              <div className="text-[10px] text-muted-foreground font-normal">
                                {state.state_code} · {state.region || 'N/A'} · {state.total_plants} plants
                              </div>
                            </TableCell>
                          </>
                        ) : null}
                        <TableCell>{site.site_name}</TableCell>
                        <TableCell className="text-center">
                          <Badge variant="secondary" className="text-xs tabular-nums">
                            {site.total_plants}
                          </Badge>
                        </TableCell>
                        {allFleetTypeNames.map(ft => (
                          <TableCell key={ft} className="text-center text-xs tabular-nums">
                            {site.fleet_types[ft] || <span className="text-muted-foreground/40">-</span>}
                          </TableCell>
                        ))}
                      </TableRow>
                    ))
                  )}
                </TableBody>
              </Table>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  )
}
