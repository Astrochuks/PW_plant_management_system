'use client'

import { useState, useMemo, useCallback } from 'react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
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
import { Skeleton } from '@/components/ui/skeleton'
import { BarChart3, Download, SlidersHorizontal } from 'lucide-react'
import { toast } from 'sonner'
import { useFleetSummary } from '@/hooks/use-dashboard'
import { exportFleetTypesExcel } from '@/lib/api/plants'
import { useLocationsWithStats } from '@/hooks/use-locations'
import type { FleetSummaryItem } from '@/lib/api/dashboard'

const CONDITIONS = [
  { key: 'working' as const, name: 'Working', color: '#10b981' },
  { key: 'standby' as const, name: 'Standby', color: '#fbbf24' },
  { key: 'breakdown' as const, name: 'Breakdown', color: '#dc2626' },
  { key: 'other' as const, name: 'Other', color: '#9ca3af' },
]

type ConditionKey = (typeof CONDITIONS)[number]['key']

interface Totals extends Record<ConditionKey, number> {
  total: number
}

export function FleetTypeBarChart() {
  const [locationId, setLocationId] = useState<string | undefined>(undefined)
  const [exporting, setExporting] = useState(false)
  const [visibleCols, setVisibleCols] = useState<Set<string>>(new Set(CONDITIONS.map(c => c.key)))

  const toggleCol = useCallback((key: string) => {
    setVisibleCols(prev => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key); else next.add(key)
      return next
    })
  }, [])

  const { data: locations } = useLocationsWithStats()
  const { data, isLoading } = useFleetSummary(locationId)

  const sorted = useMemo(() => {
    if (!data) return []
    return [...data].sort((a, b) => b.total - a.total)
  }, [data])

  const totals = useMemo<Totals>(() => {
    return sorted.reduce<Totals>(
      (acc, row) => ({
        total: acc.total + row.total,
        working: acc.working + row.working,
        standby: acc.standby + row.standby,
        breakdown: acc.breakdown + row.breakdown,
        other: acc.other + row.other,
      }),
    )
  }, [sorted])

  const handleExport = useCallback(async () => {
    if (!sorted.length) return
    setExporting(true)
    try {
      const activeCols = CONDITIONS.filter(c => visibleCols.has(c.key))
      const headers = ['Fleet Type', 'Total', ...activeCols.map(c => c.name)]
      const rows = sorted.map(row => [
        row.fleet_type, row.total, ...activeCols.map(c => row[c.key] || 0),
      ])
      rows.push([
        'TOTAL', sorted.reduce((s, r) => s + r.total, 0),
        ...activeCols.map(c => sorted.reduce((s, r) => s + (r[c.key] || 0), 0)),
      ])
      // Use backend Excel export (branded) but pass visible columns
      const colParams = ['fleet_type', 'total', ...activeCols.map(c => c.key)].join(',')
      const params: Record<string, string> = { columns: colParams }
      if (locationId) params.location_id = locationId
      const response = await (await import('@/lib/api/client')).default.get('/plants/export/fleet-types', {
        params,
        responseType: 'blob',
      })
      const url = URL.createObjectURL(response.data)
      const a = document.createElement('a')
      a.href = url
      a.download = `fleet_type_summary_${new Date().toISOString().slice(0, 10)}.xlsx`
      a.click()
      URL.revokeObjectURL(url)
    } catch { toast.error('Export failed') }
    finally { setExporting(false) }
  }, [sorted, visibleCols])

  return (
    <Card>
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between flex-wrap gap-2">
          <CardTitle className="text-base flex items-center gap-2">
            <BarChart3 className="h-4 w-4" />
            Fleet by Type
          </CardTitle>
          <div className="flex items-center gap-2">
            <Select
              value={locationId || '_all'}
              onValueChange={(v) => setLocationId(v === '_all' ? undefined : v)}
            >
              <SelectTrigger className="w-[180px] h-8 text-xs">
                <SelectValue placeholder="All Sites" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="_all">All Sites</SelectItem>
                {locations
                  ?.slice()
                  .sort((a, b) => a.location_name.localeCompare(b.location_name))
                  .map((loc) => (
                    <SelectItem key={loc.id} value={loc.id}>
                      {loc.location_name}
                    </SelectItem>
                  ))}
              </SelectContent>
            </Select>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="outline" size="sm" className="h-8">
                  <SlidersHorizontal className="h-3.5 w-3.5 mr-1" />
                  Columns
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuLabel className="text-xs">Show/Hide Columns</DropdownMenuLabel>
                <DropdownMenuSeparator />
                {CONDITIONS.map(c => (
                  <DropdownMenuCheckboxItem key={c.key} checked={visibleCols.has(c.key)} onCheckedChange={() => toggleCol(c.key)}>
                    {c.name}
                  </DropdownMenuCheckboxItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
            <Button variant="outline" size="sm" className="h-8" onClick={handleExport} disabled={exporting || !sorted.length}>
              <Download className="h-3.5 w-3.5 mr-1" />
              {exporting ? 'Exporting...' : 'Export'}
            </Button>
          </div>
        </div>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <div className="space-y-2">
            {Array.from({ length: 8 }).map((_, i) => (
              <Skeleton key={i} className="h-8 w-full" />
            ))}
          </div>
        ) : sorted.length > 0 ? (
          <>
            <div className="max-h-[420px] overflow-auto rounded-md border">
              <Table>
                <TableHeader>
                  <TableRow className="bg-muted/50">
                    <TableHead className="sticky top-0 bg-muted/95 backdrop-blur-sm z-10 text-xs font-semibold">
                      Fleet Type
                    </TableHead>
                    <TableHead className="sticky top-0 bg-muted/95 backdrop-blur-sm z-10 text-xs font-semibold text-right">
                      Total
                    </TableHead>
                    {CONDITIONS.filter(c => visibleCols.has(c.key)).map((c) => (
                      <TableHead
                        key={c.key}
                        className="sticky top-0 bg-muted/95 backdrop-blur-sm z-10 text-xs font-semibold text-right hidden sm:table-cell"
                      >
                        <span className="flex items-center justify-end gap-1.5">
                          <span
                            className="inline-block h-2 w-2 rounded-full shrink-0"
                            style={{ backgroundColor: c.color }}
                          />
                          {c.name}
                        </span>
                      </TableHead>
                    ))}
                    <TableHead className="sticky top-0 bg-muted/95 backdrop-blur-sm z-10 text-xs font-semibold w-[120px]">
                      Distribution
                    </TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {sorted.map((row) => (
                    <TableRow key={row.fleet_type} className="hover:bg-muted/30">
                      <TableCell className="font-medium text-sm py-2">
                        {row.fleet_type}
                      </TableCell>
                      <TableCell className="text-right font-semibold tabular-nums py-2">
                        {row.total}
                      </TableCell>
                      {CONDITIONS.filter(c => visibleCols.has(c.key)).map((c) => (
                        <TableCell
                          key={c.key}
                          className="text-right tabular-nums text-sm text-muted-foreground py-2 hidden sm:table-cell"
                        >
                          {row[c.key] || <span className="text-muted-foreground/40">&mdash;</span>}
                        </TableCell>
                      ))}
                      <TableCell className="py-2">
                        <ConditionBar row={row} />
                      </TableCell>
                    </TableRow>
                  ))}
                  {/* Grand total footer */}
                  <TableRow className="border-t-2 bg-muted/50 font-semibold">
                    <TableCell className="py-2 text-sm">All Types</TableCell>
                    <TableCell className="text-right tabular-nums py-2">
                      {totals.total}
                    </TableCell>
                    {CONDITIONS.filter(c => visibleCols.has(c.key)).map((c) => (
                      <TableCell
                        key={c.key}
                        className="text-right tabular-nums py-2 hidden sm:table-cell"
                      >
                        {totals[c.key]}
                      </TableCell>
                    ))}
                    <TableCell className="py-2">
                      <ConditionBar row={totals} />
                    </TableCell>
                  </TableRow>
                </TableBody>
              </Table>
            </div>
            {/* Legend (mobile-friendly since columns are hidden on small screens) */}
            <div className="flex items-center gap-4 mt-3 flex-wrap sm:hidden">
              {CONDITIONS.map((c) => (
                <div key={c.key} className="flex items-center gap-1.5 text-xs text-muted-foreground">
                  <span className="h-2.5 w-2.5 rounded-sm shrink-0" style={{ backgroundColor: c.color }} />
                  {c.name}
                </div>
              ))}
            </div>
          </>
        ) : (
          <div className="h-[200px] flex items-center justify-center text-sm text-muted-foreground">
            No fleet data available
          </div>
        )}
      </CardContent>
    </Card>
  )
}

function ConditionBar({ row }: { row: FleetSummaryItem | Totals }) {
  if (row.total === 0) return null

  return (
    <div className="flex h-3 w-full rounded-sm overflow-hidden bg-muted/30">
      {CONDITIONS.map((c) => {
        const value = row[c.key]
        if (!value) return null
        const pct = (value / row.total) * 100
        return (
          <div
            key={c.key}
            style={{ width: `${pct}%`, backgroundColor: c.color }}
            className="h-full transition-all duration-300"
            title={`${c.name}: ${value} (${Math.round(pct)}%)`}
          />
        )
      })}
    </div>
  )
}
