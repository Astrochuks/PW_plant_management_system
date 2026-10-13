'use client'

/**
 * One saved version of the bill — the admin's history view (decision
 * 2026-10-12: no approval step; previous bills are the admin's to open and
 * download). Three cards, the item-level difference against the current
 * bill, the summary, the version in full, and Export. Nothing here
 * recomputes money — figures come from the server.
 */

import { useState } from 'react'
import Link from 'next/link'
import { useParams } from 'next/navigation'
import { ArrowLeft, Download } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Skeleton } from '@/components/ui/skeleton'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { MiniKpi, MiniKpiRow } from '@/components/shared/mini-kpi'
import { useAuth } from '@/providers/auth-provider'
import { useBillsRevision, useProject } from '@/hooks/use-projects'
import { fmtDate, money, num, titleCase, unitLabel } from '@/lib/format'
import { BoqSummaryTable, adderLabel } from '@/components/projects/bills/summary-table'
import { exportRegisterExcel, type RegisterExportRow } from '@/lib/register-export'

const HEAD = 'text-[#101415] font-semibold text-xs uppercase tracking-wider border-x border-[#e6ac31]/50 whitespace-nowrap'
const CELL = 'text-sm border-x border-border/50 align-top py-2'
const STATE_LABEL: Record<string, string> = { approved: 'Current', superseded: 'Previous version', pending: 'Pending', rejected: 'Rejected' }

const fmtTriple = (m: { contract_qty: number | null; rate: number | null; contract_amount: number | null } | undefined) =>
  m ? `${m.contract_qty == null ? '—' : num(m.contract_qty)} × ${m.rate == null ? '—' : money(m.rate)} = ${m.contract_amount == null ? '—' : money(m.contract_amount)}` : '—'

export default function BillRevisionReviewPage() {
  const { id, rid } = useParams<{ id: string; rid: string }>()
  const { user } = useAuth()
  const { data: project } = useProject(id)
  const { data, isLoading } = useBillsRevision(id, rid)
  const [exporting, setExporting] = useState(false)

  if (user && user.role !== 'admin') {
    return <p className="text-sm text-muted-foreground">Previous versions of a bill are visible to admins only.</p>
  }
  if (isLoading || !data) return <Skeleton className="h-64" />
  const { revision: rev, bills, summary, diff, current_revision_no } = data
  const changes = diff ? diff.items_changed.length + diff.items_added.length + diff.items_removed.length : 0
  const projectName = titleCase(project?.short_name || project?.project_name)

  const handleExport = async () => {
    setExporting(true)
    try {
      const rows: RegisterExportRow[] = []
      for (const b of bills) {
        rows.push({ section: [`Bill ${b.bill_code}`, b.name ?? '', null, null, null, b.items_total] })
        for (const i of b.items) rows.push([i.item_code, i.description, unitLabel(i.unit), i.contract_qty, i.rate, i.contract_amount])
      }
      rows.push({ section: ['', 'SUMMARY', null, null, null, null] })
      for (const b of summary.bills) rows.push([b.bill_code, b.name ?? '', '', null, null, b.amount])
      rows.push({ section: ['', 'Works total', null, null, null, summary.works_total] })
      for (const l of summary.lines) rows.push(['', adderLabel(l), '', null, null, l.amount])
      await exportRegisterExcel({
        title: `P.W. NIGERIA LTD. — Bill of Quantities · ${projectName} · Revision ${rev.revision_no}`,
        sheetName: 'Bill of Quantities',
        columns: [
          { header: 'Item', width: 12 }, { header: 'Description', width: 70 }, { header: 'Unit', width: 8 },
          { header: 'Quantity', width: 14, numFmt: '#,##0.###' }, { header: 'Rate', width: 18, numFmt: '#,##0.00' },
          { header: 'Amount', width: 22, numFmt: '#,##0.00' },
        ],
        rows,
        totals: [null, summary.lines.length ? 'CONTRACT SUM' : 'WORKS TOTAL', null, null, null, summary.contract_total],
      })
      toast.success('Export downloaded')
    } catch (err) {
      console.error('[bills] export failed', err)
      toast.error('Export failed')
    } finally {
      setExporting(false)
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="text-lg font-semibold">Bill of Quantities · revision {rev.revision_no}</h2>
            <Badge variant={rev.state === 'approved' ? 'default' : 'secondary'}>{STATE_LABEL[rev.state] ?? rev.state}</Badge>
          </div>
          <p className="text-sm text-muted-foreground">
            Saved by {rev.recorded_by_name || rev.proposed_by_name || rev.proposed_by_email || 'admin'}{rev.created_at ? ` on ${fmtDate(rev.created_at.slice(0, 10))}` : ''}
            {' · '}effective {fmtDate(rev.effective_date)}{rev.source_file_name ? ` · ${rev.source_file_name}` : ''}
          </p>
          {rev.note && <p className="mt-1 text-sm">Note: {rev.note}</p>}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button variant="outline" size="sm" asChild>
            <Link href={`/projects/${id}/bills`}><ArrowLeft className="h-3.5 w-3.5 mr-1.5" />Back to the bill</Link>
          </Button>
          <Button variant="outline" size="sm" onClick={handleExport} disabled={exporting}>
            <Download className="h-3.5 w-3.5 mr-1.5" />{exporting ? 'Exporting...' : 'Export this version'}
          </Button>
        </div>
      </div>

      <MiniKpiRow>
        <MiniKpi label="Works total in this version" value={money(summary.works_total)} />
        {diff ? (
          <MiniKpi label={`Changed since, to revision ${current_revision_no}`} value={`${diff.works_delta >= 0 ? '+' : '−'}${money(Math.abs(diff.works_delta))}`} />
        ) : (
          <MiniKpi label="Contract sum" value={money(summary.contract_total)} />
        )}
        <MiniKpi label="Items changed" value={changes.toLocaleString()} />
      </MiniKpiRow>

      {diff && (
        <div className="rounded-lg border-2 border-border overflow-x-auto">
          <div className="px-4 py-2 bg-background border-b-2 border-border font-bold tracking-wide">
            What changed from this version to the current bill (revision {current_revision_no})
            {diff.adders_changed && <span className="ml-2 text-xs font-normal text-amber-700 dark:text-amber-400">adders changed too</span>}
            {diff.bills_added.length > 0 && <span className="ml-2 text-xs font-normal text-muted-foreground">bills added: {diff.bills_added.join(', ')}</span>}
            {diff.bills_removed.length > 0 && <span className="ml-2 text-xs font-normal text-muted-foreground">bills removed: {diff.bills_removed.join(', ')}</span>}
          </div>
          {changes === 0 ? (
            <p className="p-4 text-sm text-muted-foreground">No item differs from the current bill.</p>
          ) : (
            <Table className="border-collapse">
              <TableHeader>
                <TableRow className="bg-[#ffbf36] hover:bg-[#ffbf36] border-b-2 border-[#e6ac31]">
                  <TableHead className={`${HEAD} w-[90px]`}>Bill</TableHead>
                  <TableHead className={`${HEAD} w-[100px]`}>Item</TableHead>
                  <TableHead className={HEAD}>Description</TableHead>
                  <TableHead className={`${HEAD} w-[300px]`}>This version (qty × rate = amount)</TableHead>
                  <TableHead className={`${HEAD} w-[300px]`}>Current bill</TableHead>
                  <TableHead className={`${HEAD} w-[90px]`}>Change</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {diff.items_changed.map((c, i) => (
                  <TableRow key={`c-${i}`} className="border-b border-border">
                    <TableCell className={`${CELL} tabular-nums`}>{c.bill_code}</TableCell>
                    <TableCell className={`${CELL} tabular-nums`}>{c.item_code}</TableCell>
                    <TableCell className={`${CELL} whitespace-normal`}>{c.description}</TableCell>
                    <TableCell className={`${CELL} tabular-nums whitespace-nowrap text-muted-foreground`}>{fmtTriple(c.old)}</TableCell>
                    <TableCell className={`${CELL} tabular-nums whitespace-nowrap font-medium`}>{fmtTriple(c.new)}</TableCell>
                    <TableCell className={CELL}><Badge variant="outline" className="text-amber-700 border-amber-300">changed</Badge></TableCell>
                  </TableRow>
                ))}
                {diff.items_added.map((c, i) => (
                  <TableRow key={`a-${i}`} className="border-b border-border">
                    <TableCell className={`${CELL} tabular-nums`}>{c.bill_code}</TableCell>
                    <TableCell className={`${CELL} tabular-nums`}>{c.item_code}</TableCell>
                    <TableCell className={`${CELL} whitespace-normal`}>{c.description}</TableCell>
                    <TableCell className={`${CELL} text-muted-foreground`}>—</TableCell>
                    <TableCell className={`${CELL} tabular-nums whitespace-nowrap font-medium`}>{fmtTriple(c.new)}</TableCell>
                    <TableCell className={CELL}><Badge variant="outline" className="text-emerald-700 border-emerald-300">added since</Badge></TableCell>
                  </TableRow>
                ))}
                {diff.items_removed.map((c, i) => (
                  <TableRow key={`r-${i}`} className="border-b border-border">
                    <TableCell className={`${CELL} tabular-nums`}>{c.bill_code}</TableCell>
                    <TableCell className={`${CELL} tabular-nums`}>{c.item_code}</TableCell>
                    <TableCell className={`${CELL} whitespace-normal`}>{c.description}</TableCell>
                    <TableCell className={`${CELL} tabular-nums whitespace-nowrap text-muted-foreground`}>{fmtTriple(c.old)}</TableCell>
                    <TableCell className={`${CELL} text-muted-foreground`}>—</TableCell>
                    <TableCell className={CELL}><Badge variant="outline" className="text-red-700 border-red-300">removed since</Badge></TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </div>
      )}

      <BoqSummaryTable summary={summary} title={`Summary · revision ${rev.revision_no}`} />

      <div className="rounded-lg border-2 border-border overflow-x-auto">
        <div className="px-4 py-2 bg-background border-b-2 border-border font-bold tracking-wide">This version in full</div>
        <Table className="border-collapse">
          <TableHeader>
            <TableRow className="bg-[#ffbf36] hover:bg-[#ffbf36] border-b-2 border-[#e6ac31]">
              <TableHead className={`${HEAD} w-[110px]`}>Item</TableHead>
              <TableHead className={HEAD}>Description</TableHead>
              <TableHead className={`${HEAD} w-[80px]`}>Unit</TableHead>
              <TableHead className={`${HEAD} w-[130px] text-right`}>Quantity</TableHead>
              <TableHead className={`${HEAD} w-[170px] text-right`}>Rate</TableHead>
              <TableHead className={`${HEAD} w-[200px] text-right`}>Amount</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {bills.map((b) => [
              <TableRow key={`b-${b.bill_code}`} className="bg-[#fff3d6] hover:bg-[#fff3d6] dark:bg-[#3a2f14] dark:hover:bg-[#3a2f14] border-b border-border">
                <TableCell colSpan={5} className={`${CELL} font-semibold`}>Bill {b.bill_code}{b.name ? ` — ${b.name}` : ''}</TableCell>
                <TableCell className={`${CELL} text-right font-semibold tabular-nums whitespace-nowrap`}>{money(b.items_total)}</TableCell>
              </TableRow>,
              ...b.items.map((i, idx) => (
                <TableRow key={i.id ?? `${b.bill_code}-${idx}`} className={`${idx % 2 === 0 ? 'bg-background' : 'bg-muted/30'} border-b border-border`}>
                  <TableCell className={`${CELL} tabular-nums whitespace-nowrap`}>{i.item_code || '—'}</TableCell>
                  <TableCell className={`${CELL} min-w-[320px] whitespace-normal break-words`}>{i.description}</TableCell>
                  <TableCell className={CELL}>{i.unit ? unitLabel(i.unit) : '—'}</TableCell>
                  <TableCell className={`${CELL} text-right tabular-nums`}>{i.contract_qty != null ? num(i.contract_qty) : '—'}</TableCell>
                  <TableCell className={`${CELL} text-right tabular-nums`}>{i.rate != null ? money(i.rate) : '—'}</TableCell>
                  <TableCell className={`${CELL} text-right tabular-nums`}>{i.contract_amount != null ? money(i.contract_amount) : '—'}</TableCell>
                </TableRow>
              )),
            ])}
          </TableBody>
        </Table>
      </div>

    </div>
  )
}
