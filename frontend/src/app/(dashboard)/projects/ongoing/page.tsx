'use client'

/**
 * Ongoing projects — the projects module's front page (design approved
 * 2026-10-11), in the Plant Register's shell: icon + title, admin actions,
 * KPI cards, filters, a table/cards toggle. Cards = grouped by state with
 * state totals; table = one flat list. One period lens drives every figure;
 * figures are sums of the weeks on file (never the workbook's "to date").
 */

import { Suspense, useMemo, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { Banknote, CalendarDays, Download, FolderKanban, LayoutGrid, Map, Plus, Radio, Table2, UploadCloud } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Skeleton } from '@/components/ui/skeleton'
import { MiniKpi, MiniKpiGrid, MiniKpiSkeleton } from '@/components/shared/mini-kpi'
import { ProtectedRoute } from '@/components/protected-route'
import { useAuth } from '@/providers/auth-provider'
import { useExecutiveSummary, useOngoingProjects } from '@/hooks/use-projects'
import { useUrlFilters } from '@/hooks/use-url-filters'
import { STATUS_STYLES } from '@/components/projects/projects-table'
import { StateSections, StateStrip, groupByState } from '@/components/projects/ongoing/portfolio-by-state'
import { LENS_OPTIONS, type LensKey, EMPTY, addFigures, lensLabel, marginOf } from '@/components/projects/ongoing/lens'
import { fmtDate, money } from '@/lib/format'

const today = () => new Date().toISOString().slice(0, 10)
const FILTER_DEFAULTS = { lens: 'stored', as_at: '', state: '', display: 'cards' }

export default function OngoingProjectsPage() {
  return (
    <ProtectedRoute requiredRole="projects">
      <Suspense fallback={<Skeleton className="h-96" />}>
        <OngoingContent />
      </Suspense>
    </ProtectedRoute>
  )
}

function OngoingContent() {
  const router = useRouter()
  const { user } = useAuth()
  const isAdmin = user?.role === 'admin'
  const [filters, setFilters] = useUrlFilters(FILTER_DEFAULTS)
  const lens = (LENS_OPTIONS.some((o) => o.key === filters.lens) ? filters.lens : 'stored') as LensKey
  const asAt = filters.as_at || today()
  const display = filters.display === 'table' ? 'table' : 'cards'
  const stateFilter = filters.state || ''

  const { data: ongoing, isLoading: loadingList, isFetching } = useOngoingProjects(asAt)
  const { data: exec, isLoading: loadingExec } = useExecutiveSummary()
  const isLoading = loadingList || loadingExec

  const groups = useMemo(() => {
    if (!ongoing) return []
    const rows = stateFilter ? ongoing.data.filter((p) => (p.state_name || '') === stateFilter) : ongoing.data
    return groupByState(rows, exec?.projects ?? [], exec?.series ?? [], lens, asAt)
  }, [ongoing, exec, lens, asAt, stateFilter])

  const states = useMemo(
    () => [...new Set((ongoing?.data ?? []).map((p) => p.state_name).filter(Boolean) as string[])].sort(),
    [ongoing])
  const totals = groups.reduce((a, g) => addFigures(a, g.totals), EMPTY)
  const reporting = groups.reduce((a, g) => a + g.reporting, 0)
  const siteCount = groups.reduce((a, g) => a + g.sites.length, 0)
  const contractTotal = groups.reduce((a, g) => a + g.contract, 0)
  const [exporting, setExporting] = useState(false)

  const exportXlsx = async () => {
    const rows = groups.flatMap((g) => g.sites)
    if (!rows.length) return
    setExporting(true)
    try {
      const { Workbook } = await import('exceljs')
      const wb = new Workbook()
      const ws = wb.addWorksheet('Ongoing projects')
      ws.addRow(['P.W. NIGERIA LIMITED — ON-GOING PROJECTS']).font = { bold: true, size: 13 }
      ws.addRow([`As at ${fmtDate(asAt)} · period: ${lensLabel(lens, asAt)} · ${rows.length} projects`])
      ws.addRow([])
      ws.addRow(['S/NO', 'PROJECT', 'STATE', 'CLIENT', 'STATUS', 'SINCE', 'CONTRACT SUM (₦)', 'WORK DONE INCL. VAT (₦)', 'COST (₦)', 'NET EARNINGS (₦)', 'MARGIN', 'WEEKS COUNTED']).font = { bold: true }
      rows.forEach((r, i) => {
        const m = marginOf(r.figures)
        ws.addRow([i + 1, r.project.project_name, r.project.state_name ?? '', r.project.client, STATUS_STYLES[r.project.status]?.label ?? r.project.status,
          r.project.status_since, r.project.contract_sum ?? null, r.figures.works_incl_vat || null, r.figures.cost || null, r.figures.weeks ? r.figures.net : null, m, r.figures.weeks])
      })
      ws.addRow(['', 'TOTAL', '', '', '', '', contractTotal, totals.works_incl_vat, totals.cost, totals.net, marginOf(totals), totals.weeks]).font = { bold: true }
      ;[7, 8, 9, 10].forEach((c) => { ws.getColumn(c).numFmt = '#,##0.00' })
      ws.getColumn(11).numFmt = '0.0%'
      ws.columns.forEach((c, i) => { c.width = [6, 60, 14, 32, 14, 12, 22, 24, 20, 22, 10, 10][i] ?? 14 })
      const buf = await wb.xlsx.writeBuffer()
      const url = URL.createObjectURL(new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }))
      const a = document.createElement('a'); a.href = url; a.download = `ongoing-projects-${asAt}.xlsx`; a.click()
      URL.revokeObjectURL(url)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Export failed')
    } finally {
      setExporting(false)
    }
  }

  return (
    <div className="space-y-6">
      {/* Header — the plant register's shell */}
      <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
        <div className="flex items-center gap-3">
          <div className="p-2.5 rounded-xl bg-primary/10"><FolderKanban className="h-6 w-6 text-primary" /></div>
          <div>
            <h1 className="text-2xl font-bold tracking-tight">Ongoing Projects</h1>
            <p className="text-sm text-muted-foreground">
              {isLoading ? 'Loading…' : `${siteCount} site${siteCount !== 1 ? 's' : ''} in ${groups.length} state${groups.length !== 1 ? 's' : ''} · contract ${money(contractTotal)}`}
            </p>
          </div>
        </div>
        {isAdmin && (
          <div className="flex items-center rounded-lg border bg-card p-0.5 w-fit">
            <Button asChild size="sm" variant="ghost" className="text-muted-foreground hover:text-foreground">
              <Link href="/projects/submissions" title="Weekly Reports"><UploadCloud className="h-4 w-4" /><span className="hidden md:inline md:ml-2">Weekly Reports</span></Link>
            </Button>
            <div className="h-4 w-px bg-border" />
            <Button asChild size="sm" variant="ghost" className="text-muted-foreground hover:text-foreground">
              <Link href="/projects" title="Full register"><Table2 className="h-4 w-4" /><span className="hidden md:inline md:ml-2">Full register</span></Link>
            </Button>
          </div>
        )}
      </div>

      {/* Register cards — every one follows the state filter, the lens and the as-at date */}
      <MiniKpiGrid cols={4}>
        {isLoading ? <MiniKpiSkeleton count={4} /> : (
          <>
            <MiniKpi icon={FolderKanban} iconColor="text-blue-600 dark:text-blue-400"
              label={stateFilter ? `Ongoing projects in ${stateFilter}` : 'Ongoing projects'}
              value={siteCount.toLocaleString()}
              sub={stateFilter ? `as at ${fmtDate(asAt)}` : `in ${groups.length} state${groups.length !== 1 ? 's' : ''} · as at ${fmtDate(asAt)}`} />
            <MiniKpi icon={Map} iconColor="text-violet-600 dark:text-violet-400"
              label="States" value={groups.length.toLocaleString()}
              sub={groups.map((g) => g.state).join(', ') || '—'} />
            <MiniKpi icon={Banknote} iconColor="text-amber-600 dark:text-amber-400"
              label="Total contract sum" value={money(contractTotal)}
              sub="as recorded in the register" />
            <MiniKpi icon={Radio} iconColor={reporting ? 'text-emerald-600 dark:text-emerald-400' : 'text-muted-foreground'}
              label="Reporting" value={`${reporting} of ${siteCount}`}
              sub={`${lensLabel(lens, asAt)} · net ${money(totals.net)}`} tone={totals.weeks && totals.net < 0 ? 'bad' : undefined} />
          </>
        )}
      </MiniKpiGrid>

      {/* Period lens + filters */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex items-center gap-1 rounded-lg bg-muted p-1 w-fit">
          {LENS_OPTIONS.map((o) => (
            <button key={o.key} type="button" onClick={() => setFilters({ lens: o.key })}
              className={`px-3 py-1.5 text-sm font-medium rounded-md transition-colors ${lens === o.key ? 'bg-primary/20 text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground'}`}>
              {o.label}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-2">
          <CalendarDays className="h-4 w-4 text-muted-foreground" />
          <Input type="date" value={asAt} max={today()} onChange={(e) => e.target.value && setFilters({ as_at: e.target.value === today() ? '' : e.target.value })} className="h-9 w-40" aria-label="As at" />
        </div>
        <Select value={stateFilter || 'all'} onValueChange={(v) => setFilters({ state: v === 'all' ? '' : v })}>
          <SelectTrigger className="h-9 w-44"><SelectValue placeholder="All states" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All states</SelectItem>
            {states.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}
          </SelectContent>
        </Select>
      </div>

      {/* State strip */}
      {!isLoading && groups.length > 0 && <StateStrip groups={groups} totalNet={totals.net} />}

      {/* Toolbar: result text · actions · view toggle */}
      <div className="flex flex-wrap items-center justify-between gap-2 py-1">
        <p className="text-sm text-muted-foreground">
          {isLoading ? '' : `Showing ${siteCount} ongoing project${siteCount !== 1 ? 's' : ''} as at ${fmtDate(asAt)}`}
          {isFetching && !isLoading ? ' · refreshing…' : ''}
        </p>
        <div className="flex flex-wrap items-center gap-2">
          <Button variant="outline" size="sm" onClick={exportXlsx} disabled={exporting || isLoading || !siteCount}>
            <Download className="h-4 w-4 mr-2" />Export Excel
          </Button>
          {isAdmin && (
            <Button asChild size="sm" className="shadow-sm">
              <Link href="/projects/create"><Plus className="h-4 w-4 mr-2" />Add Project</Link>
            </Button>
          )}
          <div className="flex items-center rounded-lg border p-0.5">
            <Button variant={display === 'table' ? 'secondary' : 'ghost'} size="sm" className="h-7 px-2" onClick={() => setFilters({ display: 'table' })} title="Table view" aria-pressed={display === 'table'}><Table2 className="h-4 w-4" /></Button>
            <Button variant={display === 'cards' ? 'secondary' : 'ghost'} size="sm" className="h-7 px-2" onClick={() => setFilters({ display: 'cards' })} title="Card view" aria-pressed={display === 'cards'}><LayoutGrid className="h-4 w-4" /></Button>
          </div>
        </div>
      </div>

      {display === 'cards' ? (
        <StateSections groups={groups} isLoading={isLoading} />
      ) : (
        <div className="rounded-lg border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Project</TableHead><TableHead>State</TableHead><TableHead>Status</TableHead>
                <TableHead className="text-right">Contract sum</TableHead>
                <TableHead className="text-right">Work done · incl. VAT</TableHead>
                <TableHead className="text-right">Cost</TableHead>
                <TableHead className="text-right">Net earnings</TableHead>
                <TableHead className="text-right">Margin</TableHead>
                <TableHead>Last report</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading ? (
                <TableRow><TableCell colSpan={9} className="py-8 text-center text-sm text-muted-foreground">Loading…</TableCell></TableRow>
              ) : groups.flatMap((g) => g.sites).map((r) => {
                const m = marginOf(r.figures); const has = r.figures.weeks > 0
                const style = STATUS_STYLES[r.project.status] || STATUS_STYLES.active
                return (
                  <TableRow key={r.project.id} className="cursor-pointer" onClick={() => router.push(`/projects/${r.project.id}`)}>
                    <TableCell>
                      <div className="font-medium">{r.project.short_name || r.project.project_name}</div>
                      {r.project.short_name && <div className="max-w-md truncate text-xs text-muted-foreground">{r.project.project_name}</div>}
                    </TableCell>
                    <TableCell className="text-sm">{r.project.state_name ?? '—'}</TableCell>
                    <TableCell>
                      {r.weeks_received === 0
                        ? <Badge variant="outline" className="text-muted-foreground">Awaiting first report</Badge>
                        : <Badge variant={style.variant} className={style.className}>{style.label}</Badge>}
                    </TableCell>
                    <TableCell className="text-right text-sm tabular-nums">{r.project.contract_sum != null ? money(r.project.contract_sum) : '—'}</TableCell>
                    <TableCell className="text-right text-sm tabular-nums">{has ? money(r.figures.works_incl_vat) : <span className="text-muted-foreground">—</span>}</TableCell>
                    <TableCell className="text-right text-sm tabular-nums">{has ? money(r.figures.cost) : <span className="text-muted-foreground">—</span>}</TableCell>
                    <TableCell className={`text-right text-sm font-medium tabular-nums ${has && r.figures.net < 0 ? 'text-red-600' : ''}`}>{has ? money(r.figures.net) : <span className="text-muted-foreground">—</span>}</TableCell>
                    <TableCell className="text-right text-sm tabular-nums">{m == null ? <span className="text-muted-foreground">—</span> : `${(m * 100).toFixed(1)}%`}</TableCell>
                    <TableCell className="text-xs text-muted-foreground tabular-nums">{r.latest_week_ending ? fmtDate(r.latest_week_ending) : 'never'}</TableCell>
                  </TableRow>
                )
              })}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  )
}
