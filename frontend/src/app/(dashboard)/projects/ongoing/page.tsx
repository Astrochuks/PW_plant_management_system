'use client'

/**
 * Ongoing projects as at a date — the head-office list, live (PRD v2 §5.4).
 * Status and contract sum are read from history as they stood on that day,
 * so Kwoi is on the Q2 list and off today's. Export = the same rows to xlsx.
 */

import { useState } from 'react'
import Link from 'next/link'
import { CalendarDays, Download } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Card, CardContent } from '@/components/ui/card'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { ProtectedRoute } from '@/components/protected-route'
import { useOngoingProjects } from '@/hooks/use-projects'
import { STATUS_STYLES } from '@/components/projects/projects-table'
import { fmtDate, money } from '@/lib/format'

const today = () => new Date().toISOString().slice(0, 10)
const BASIS: Record<string, string> = { all_in: 'all-in', ex_vat: 'ex-VAT', unknown: 'basis unknown' }

export default function OngoingProjectsPage() {
  return (
    <ProtectedRoute requiredRole="projects">
      <OngoingContent />
    </ProtectedRoute>
  )
}

function OngoingContent() {
  const [asAt, setAsAt] = useState(today())
  const { data, isLoading, isFetching } = useOngoingProjects(asAt)
  const rows = data?.data ?? []
  const [exporting, setExporting] = useState(false)

  const exportXlsx = async () => {
    if (!rows.length) return
    setExporting(true)
    try {
      const { Workbook } = await import('exceljs')
      const wb = new Workbook()
      const ws = wb.addWorksheet('Ongoing projects')
      ws.addRow(['P.W. NIGERIA LIMITED — ON-GOING PROJECTS']).font = { bold: true, size: 13 }
      ws.addRow([`As at ${fmtDate(asAt)} · ${rows.length} projects`])
      ws.addRow([])
      const header = ws.addRow(['S/NO', 'PROJECT', 'CLIENT', 'LOCATION', 'STATUS', 'SINCE', 'CONTRACT SUM (₦)', 'BASIS'])
      header.font = { bold: true }
      rows.forEach((p, i) => {
        ws.addRow([
          i + 1, p.project_name, p.client, p.state_name ?? '', STATUS_STYLES[p.status]?.label ?? p.status,
          p.status_since, p.contract_sum ?? null, BASIS[p.contract_sum_basis ?? 'unknown'],
        ])
      })
      const total = ws.addRow(['', 'TOTAL', '', '', '', '', data?.meta.total_contract_sum ?? 0, ''])
      total.font = { bold: true }
      ws.getColumn(7).numFmt = '#,##0.00'
      ws.columns.forEach((c, i) => { c.width = [6, 70, 32, 16, 16, 12, 22, 14][i] ?? 14 })
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
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Ongoing Projects</h1>
          <p className="text-sm text-muted-foreground">
            Every project that was mobilised, active or suspended on the chosen date, with the contract sum as it stood then.
          </p>
        </div>
        <div className="flex items-end gap-3">
          <div>
            <Label htmlFor="asat" className="text-xs">As at</Label>
            <div className="flex items-center gap-2">
              <CalendarDays className="h-4 w-4 text-muted-foreground" />
              <Input id="asat" type="date" value={asAt} max={today()} onChange={(e) => e.target.value && setAsAt(e.target.value)} className="w-44" />
            </div>
          </div>
          <Button variant="outline" onClick={exportXlsx} disabled={exporting || !rows.length}>
            <Download className="mr-2 h-4 w-4" /> Export Excel
          </Button>
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <Card><CardContent className="p-4">
          <div className="text-xs uppercase tracking-wide text-muted-foreground">Projects ongoing as at {fmtDate(asAt)}</div>
          <div className="mt-1 text-2xl font-semibold tabular-nums">{isLoading ? '…' : data?.meta.count ?? 0}</div>
        </CardContent></Card>
        <Card><CardContent className="p-4">
          <div className="text-xs uppercase tracking-wide text-muted-foreground">Total contract sum (as recorded)</div>
          <div className="mt-1 text-2xl font-semibold tabular-nums">{isLoading ? '…' : money(data?.meta.total_contract_sum ?? 0)}</div>
          <div className="text-[11px] text-muted-foreground">Sums of mixed basis are added as recorded — see the Basis column.</div>
        </CardContent></Card>
      </div>

      <div className={`rounded-lg border ${isFetching ? 'opacity-70' : ''}`}>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-10">#</TableHead>
              <TableHead>Project</TableHead>
              <TableHead>Client</TableHead>
              <TableHead>Location</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Since</TableHead>
              <TableHead className="text-right">Contract sum</TableHead>
              <TableHead>Basis</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading ? (
              <TableRow><TableCell colSpan={8} className="py-8 text-center text-sm text-muted-foreground">Loading…</TableCell></TableRow>
            ) : rows.length === 0 ? (
              <TableRow><TableCell colSpan={8} className="py-8 text-center text-sm text-muted-foreground">No project was ongoing on {fmtDate(asAt)}.</TableCell></TableRow>
            ) : rows.map((p, i) => {
              const style = STATUS_STYLES[p.status] || STATUS_STYLES.active
              return (
                <TableRow key={p.id}>
                  <TableCell className="text-muted-foreground">{i + 1}</TableCell>
                  <TableCell>
                    <Link href={`/projects/${p.id}`} className="font-medium hover:underline">{p.short_name || p.project_name}</Link>
                    {p.short_name && <div className="max-w-md truncate text-xs text-muted-foreground">{p.project_name}</div>}
                  </TableCell>
                  <TableCell className="text-sm">{p.client}</TableCell>
                  <TableCell className="text-sm">{p.state_name ?? '—'}</TableCell>
                  <TableCell><Badge variant={style.variant} className={style.className}>{style.label}</Badge></TableCell>
                  <TableCell className="text-sm tabular-nums">{fmtDate(p.status_since)}</TableCell>
                  <TableCell className="text-right text-sm tabular-nums">{p.contract_sum != null ? money(p.contract_sum) : '—'}</TableCell>
                  <TableCell className="text-xs text-muted-foreground">{BASIS[p.contract_sum_basis ?? 'unknown']}</TableCell>
                </TableRow>
              )
            })}
          </TableBody>
        </Table>
      </div>
    </div>
  )
}
