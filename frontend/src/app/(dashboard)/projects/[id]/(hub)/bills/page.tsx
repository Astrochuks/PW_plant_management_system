'use client'

/**
 * Bill of Quantities — the project's bill as the site works to it, in the
 * register design (docs/UI_STANDARD.md §3, §3b): bills are section rows,
 * items are rows, the works total closes the table. One API call. The
 * three cards follow the filters (bill picker + search). Export = the
 * screen. Admin: import a bill (.xlsx, the company's BEME sheet layout)
 * → preview our Σ per bill against the sheet's own totals → save as the
 * next revision. Approval by the project manager is the next milestone.
 */

import { useMemo, useState } from 'react'
import Image from 'next/image'
import Link from 'next/link'
import { useParams } from 'next/navigation'
import { AlertTriangle, CheckCircle2, Download, FileUp, History, PencilLine, Search, SlidersHorizontal, X } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Badge } from '@/components/ui/badge'
import { Skeleton } from '@/components/ui/skeleton'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog'
import { MiniKpi, MiniKpiRow, MiniKpiSkeleton } from '@/components/shared/mini-kpi'
import { useAuth } from '@/providers/auth-provider'
import { useProject, useProjectBills, useProjectSubmissions, usePreviewBillsImport, usePreviewBillsFromSubmission, useRecordBillsRevision } from '@/hooks/use-projects'
import type { BoqAdder, BoqBill, BoqImportPreview } from '@/lib/api/projects'
import { getErrorMessage } from '@/lib/api/client'
import { fmtDate, money, num, unitLabel } from '@/lib/format'
import { exportRegisterExcel, type RegisterExportRow } from '@/lib/register-export'
import { BoqSummaryTable, adderLabel } from '@/components/projects/bills/summary-table'
import { AddersDialog } from '@/components/projects/bills/adders-dialog'

const SOURCE_HOW: Record<string, string> = {
  award_beme: 'imported from a bill file',
  derived_from_weekly: 'from a weekly workbook',
  variation: 'variation',
  correction: 'edited by hand',
}

const HEAD = 'text-[#101415] font-semibold text-xs uppercase tracking-wider border-x border-[#e6ac31]/50 whitespace-nowrap'
const CELL = 'text-sm border-x border-border/50 align-top py-2'
const sumVisible = (b: BoqBill) => b.items.reduce((a, i) => a + (i.contract_amount ?? 0), 0)
const differs = (a: number, b: number | null) => b != null && Math.abs(a - b) > 0.01

export default function ProjectBillsPage() {
  const { id } = useParams<{ id: string }>()
  const { user } = useAuth()
  const isAdmin = user?.role === 'admin'
  const { data: project } = useProject(id)
  const { data, isLoading } = useProjectBills(id)
  const [search, setSearch] = useState('')
  const [billCode, setBillCode] = useState('all')
  const [importOpen, setImportOpen] = useState(false)
  const [addersOpen, setAddersOpen] = useState(false)
  const [historyOpen, setHistoryOpen] = useState(false)
  const [exporting, setExporting] = useState(false)

  const bills = useMemo(() => data?.bills ?? [], [data])
  const revision = data?.revision ?? null
  const summary = data?.summary ?? null
  const adders = useMemo(() => revision?.adders ?? [], [revision])
  const revisions = data?.revisions ?? []

  // the rows on screen: one bill or all, items narrowed by code / description
  const visible = useMemo(() => {
    const q = search.trim().toLowerCase()
    return bills
      .filter((b) => billCode === 'all' || b.bill_code === billCode)
      .map((b) => (q ? { ...b, items: b.items.filter((i) => i.item_code.toLowerCase().includes(q) || i.description.toLowerCase().includes(q)) } : b))
      .filter((b) => !q || b.items.length > 0)
  }, [bills, billCode, search])

  const itemCount = visible.reduce((a, b) => a + b.items.length, 0)
  const worksTotal = visible.reduce((a, b) => a + sumVisible(b), 0)
  const hasFilters = Boolean(search || billCode !== 'all')

  const projectName = project?.short_name || project?.project_name || ''
  const scope = (billCode === 'all' ? 'all bills' : `Bill ${billCode}`) + (search ? ` · search "${search}"` : '')
  const bannerTitle = `P.W. NIGERIA LTD. — Bill of Quantities · ${projectName}${revision ? ` · Revision ${revision.revision_no}` : ''} · ${scope}`

  const handleExport = async () => {
    setExporting(true)
    try {
      const rows: RegisterExportRow[] = []
      for (const b of visible) {
        rows.push({ section: [`Bill ${b.bill_code}`, b.name ?? '', null, null, null, sumVisible(b)] })
        for (const i of b.items) rows.push([i.item_code, i.description, unitLabel(i.unit), i.contract_qty, i.rate, i.contract_amount])
      }
      // the summary closes the sheet, as the BEME does: bills, works total, adders, contract sum
      if (summary && !hasFilters) {
        rows.push({ section: ['', 'SUMMARY', null, null, null, null] })
        for (const b of summary.bills) rows.push([b.bill_code, b.name ?? '', '', null, null, b.amount])
        rows.push({ section: ['', 'Works total', null, null, null, summary.works_total] })
        for (const l of summary.lines) rows.push(['', adderLabel(l), '', null, null, l.amount])
      }
      await exportRegisterExcel({
        title: bannerTitle,
        sheetName: 'Bill of Quantities',
        columns: [
          { header: 'Item', width: 12 }, { header: 'Description', width: 70 }, { header: 'Unit', width: 8 },
          { header: 'Quantity', width: 14, numFmt: '#,##0.###' }, { header: 'Rate', width: 18, numFmt: '#,##0.00' },
          { header: 'Amount', width: 22, numFmt: '#,##0.00' },
        ],
        rows,
        totals: [null, summary && !hasFilters ? (summary.lines.length ? 'CONTRACT SUM' : 'WORKS TOTAL') : null, null, null, null, summary && !hasFilters ? summary.contract_total : worksTotal],
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
      {/* Header */}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <h2 className="text-lg font-semibold">Bill of Quantities</h2>
        <div className="flex flex-wrap items-center gap-2">
          {isAdmin && revisions.length > 0 && (
            <Button variant="ghost" size="sm" onClick={() => setHistoryOpen(true)} title="Every saved version of this bill, with its date">
              <History className="h-3.5 w-3.5 mr-1.5" />History{revisions.length > 1 ? ` (${revisions.length})` : ''}
            </Button>
          )}
          <Button variant="outline" size="sm" onClick={handleExport} disabled={exporting || isLoading || itemCount === 0}>
            <Download className="h-3.5 w-3.5 mr-1.5" />{exporting ? 'Exporting...' : 'Export'}
          </Button>
          {isAdmin && revision && (
            <Button variant="outline" size="sm" onClick={() => setAddersOpen(true)}>
              <SlidersHorizontal className="h-3.5 w-3.5 mr-1.5" />Adders{adders.length ? ` (${adders.length})` : ''}
            </Button>
          )}
          {isAdmin && (
            <Button variant="outline" size="sm" asChild>
              <Link href={`/projects/${id}/bills/edit`}><PencilLine className="h-3.5 w-3.5 mr-1.5" />{revision ? 'Edit by hand' : 'Enter by hand'}</Link>
            </Button>
          )}
          {isAdmin && (
            <Button size="sm" onClick={() => setImportOpen(true)}>
              <FileUp className="h-3.5 w-3.5 mr-1.5" />Import bill
            </Button>
          )}
        </div>
      </div>

      {/* Summary first — the table the sheet ends with */}
      {summary && !hasFilters && (
        <BoqSummaryTable summary={summary} title={`P.W. NIGERIA LTD. — Bill of Quantities Summary · ${projectName}`} />
      )}

      {/* Three cards — follow the filters */}
      <MiniKpiRow>
        {isLoading ? <MiniKpiSkeleton count={3} /> : (
          <>
            <MiniKpi label={billCode === 'all' ? 'Bills' : `Bill ${billCode}`} value={visible.length.toLocaleString()} />
            <MiniKpi label="Items" value={itemCount.toLocaleString()} />
            <MiniKpi label={billCode === 'all' ? 'Works total across all bills' : `Works total in Bill ${billCode}`} value={money(worksTotal)} />
          </>
        )}
      </MiniKpiRow>

      {/* Search + bill filter */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="relative flex-1 min-w-[220px] max-w-md">
          <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 h-5 w-5 text-muted-foreground" />
          <Input placeholder="Search items by code or description..." value={search} onChange={(e) => setSearch(e.target.value)}
            className="pl-11 h-11 text-base" aria-label="Search items" />
        </div>
        <Select value={billCode} onValueChange={setBillCode}>
          <SelectTrigger className="h-11 w-full sm:w-72" aria-label="Filter by bill"><SelectValue placeholder="All bills" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All bills</SelectItem>
            {bills.map((b) => <SelectItem key={b.bill_code} value={b.bill_code}>Bill {b.bill_code}{b.name ? ` — ${b.name}` : ''}</SelectItem>)}
          </SelectContent>
        </Select>
        {hasFilters && (
          <Button variant="ghost" size="sm" onClick={() => { setSearch(''); setBillCode('all') }}>
            <X className="h-4 w-4 mr-1" />Clear filters
          </Button>
        )}
      </div>

      {/* The bill */}
      {isLoading ? (
        <Skeleton className="h-64" />
      ) : bills.length === 0 ? (
        <div className="text-center py-12 text-muted-foreground border rounded-lg">
          <p className="text-lg">No bill of quantities yet</p>
          <p className="text-sm mt-1">{isAdmin ? 'Import the bill (.xlsx) to record revision 1.' : 'The admin has not recorded this project’s bill yet.'}</p>
          {isAdmin && (
            <div className="mt-4 flex flex-wrap justify-center gap-2">
              <Button size="sm" onClick={() => setImportOpen(true)}><FileUp className="h-3.5 w-3.5 mr-1.5" />Import bill</Button>
              <Button size="sm" variant="outline" asChild><Link href={`/projects/${id}/bills/edit`}><PencilLine className="h-3.5 w-3.5 mr-1.5" />Enter by hand</Link></Button>
            </div>
          )}
        </div>
      ) : visible.length === 0 ? (
        <div className="text-center py-12 text-muted-foreground border rounded-lg">
          <p className="text-lg">No items match</p>
          <p className="text-sm mt-1">Try another bill or search term</p>
        </div>
      ) : (
        <div className="rounded-lg border-2 border-border overflow-x-auto">
          <div className="flex items-center gap-3 px-4 py-2 bg-background border-b-2 border-border">
            <Image src="/images/logo.png" alt="P.W. Nigeria Ltd." width={55} height={55} className="rounded shrink-0" />
            <span className="text-foreground font-bold text-base tracking-wide">{bannerTitle}</span>
          </div>
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
              {visible.map((b) => {
                const sub = sumVisible(b)
                const sheetDiffers = !search && differs(b.items_total, b.sheet_total)
                return [
                  <TableRow key={`bill-${b.bill_code}`} className="bg-[#fff3d6] hover:bg-[#fff3d6] dark:bg-[#3a2f14] dark:hover:bg-[#3a2f14] border-b border-border">
                    <TableCell colSpan={5} className={`${CELL} font-semibold`}>
                      Bill {b.bill_code}{b.name ? ` — ${b.name}` : ''}
                      <span className="ml-2 text-xs font-normal text-muted-foreground">{b.items.length} item{b.items.length !== 1 ? 's' : ''}</span>
                      {sheetDiffers && (
                        <span className="ml-2 inline-flex items-center gap-1 text-xs font-normal text-amber-700 dark:text-amber-400">
                          <AlertTriangle className="h-3 w-3" />sheet total {money(b.sheet_total as number)}
                        </span>
                      )}
                    </TableCell>
                    <TableCell className={`${CELL} text-right font-semibold tabular-nums whitespace-nowrap`}>{money(sub)}</TableCell>
                  </TableRow>,
                  ...b.items.map((i, idx) => (
                    <TableRow key={i.id ?? `${b.bill_code}-${i.item_code}-${idx}`} className={`${idx % 2 === 0 ? 'bg-background' : 'bg-muted/30'} hover:bg-muted/60 border-b border-border`}>
                      <TableCell className={`${CELL} tabular-nums whitespace-nowrap`}>{i.item_code || <span className="text-muted-foreground">—</span>}</TableCell>
                      <TableCell className={`${CELL} min-w-[320px] whitespace-normal break-words`}>{i.description}</TableCell>
                      <TableCell className={CELL}>{i.unit ? unitLabel(i.unit) : <span className="text-muted-foreground">—</span>}</TableCell>
                      <TableCell className={`${CELL} text-right tabular-nums whitespace-nowrap`}>{i.contract_qty != null ? num(i.contract_qty) : <span className="text-muted-foreground">—</span>}</TableCell>
                      <TableCell className={`${CELL} text-right tabular-nums whitespace-nowrap`}>{i.rate != null ? money(i.rate) : <span className="text-muted-foreground">—</span>}</TableCell>
                      <TableCell className={`${CELL} text-right tabular-nums whitespace-nowrap`}>{i.contract_amount != null ? money(i.contract_amount) : <span className="text-muted-foreground">—</span>}</TableCell>
                    </TableRow>
                  )),
                ]
              })}
              <TableRow className="bg-background hover:bg-background border-t-2 border-border">
                <TableCell colSpan={5} className={`${CELL} font-bold uppercase tracking-wide`}>Works total {billCode === 'all' ? 'across all bills' : `in Bill ${billCode}`}</TableCell>
                <TableCell className={`${CELL} text-right font-bold tabular-nums whitespace-nowrap`}>{money(worksTotal)}</TableCell>
              </TableRow>
            </TableBody>
          </Table>
        </div>
      )}

      {isAdmin && (
        <>
          <ImportBillDialog projectId={id} open={importOpen} onOpenChange={setImportOpen}
            nextRevisionNo={(revision?.revision_no ?? 0) + 1} adders={adders} />
          <AddersDialog projectId={id} open={addersOpen} onOpenChange={setAddersOpen} adders={adders} />
          <Dialog open={historyOpen} onOpenChange={setHistoryOpen}>
            <DialogContent className="sm:max-w-2xl">
              <DialogHeader>
                <DialogTitle>Bill history</DialogTitle>
                <DialogDescription>
                  Every saved version of this bill. The newest is what everyone sees; earlier ones are kept for you to open and download.
                </DialogDescription>
              </DialogHeader>
              <div className="rounded-lg border overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="w-[60px]">Rev.</TableHead><TableHead>Saved</TableHead><TableHead>By</TableHead>
                      <TableHead>How</TableHead><TableHead className="text-right">Works total</TableHead><TableHead className="w-[80px]" />
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {revisions.map((r) => (
                      <TableRow key={r.id}>
                        <TableCell className="tabular-nums">{r.revision_no}{r.id === revision?.id && <Badge variant="secondary" className="ml-2 text-[10px]">current</Badge>}</TableCell>
                        <TableCell className="whitespace-nowrap">{fmtDate(r.created_at.slice(0, 10))}</TableCell>
                        <TableCell className="whitespace-nowrap">{r.recorded_by_name || r.recorded_by_email || '—'}</TableCell>
                        <TableCell className="whitespace-normal text-xs text-muted-foreground">{SOURCE_HOW[r.source] ?? r.source}{r.note ? ` · ${r.note}` : ''}</TableCell>
                        <TableCell className="text-right tabular-nums whitespace-nowrap">{r.works_total != null ? money(r.works_total) : '—'}</TableCell>
                        <TableCell><Button variant="outline" size="sm" asChild><Link href={`/projects/${id}/bills/revisions/${r.id}`}>Open</Link></Button></TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            </DialogContent>
          </Dialog>
        </>
      )}
    </div>
  )
}

// ── Import: file → preview → save as revision n ─────────────────────────

function ImportBillDialog({ projectId, open, onOpenChange, nextRevisionNo, adders }: {
  projectId: string; open: boolean; onOpenChange: (v: boolean) => void; nextRevisionNo: number; adders: BoqAdder[]
}) {
  const preview = usePreviewBillsImport(projectId)
  const previewFromSubmission = usePreviewBillsFromSubmission(projectId)
  const record = useRecordBillsRevision(projectId)
  // the second door: a weekly workbook this project already uploaded
  const { data: submissions } = useProjectSubmissions({ project_id: projectId, limit: 50 })
  const usable = useMemo(() => (submissions?.data ?? []).filter((s) => s.status === 'success' || s.status === 'partial'), [submissions])
  const [door, setDoor] = useState<'file' | 'workbook'>('file')
  const [submissionId, setSubmissionId] = useState('')
  const [file, setFile] = useState<File | null>(null)
  const [result, setResult] = useState<BoqImportPreview | null>(null)
  const [effectiveDate, setEffectiveDate] = useState(() => new Date().toISOString().slice(0, 10))
  const [source, setSource] = useState<'award_beme' | 'variation' | 'correction'>(nextRevisionNo > 1 ? 'correction' : 'award_beme')
  const [note, setNote] = useState('')

  const reset = () => { setFile(null); setResult(null); setNote('') }
  const close = (v: boolean) => { if (!v) reset(); onOpenChange(v) }

  const readFile = async () => {
    try {
      if (door === 'workbook') {
        if (!submissionId) return toast.error('Choose the weekly workbook first')
        setResult(await previewFromSubmission.mutateAsync(submissionId))
      } else {
        if (!file) return toast.error('Choose the bill file first (.xlsx)')
        setResult(await preview.mutateAsync(file))
      }
    } catch (err) {
      toast.error(getErrorMessage(err))
    }
  }
  const reading = preview.isPending || previewFromSubmission.isPending

  const save = async () => {
    if (!result) return
    if (!effectiveDate) return toast.error('Enter the date the bill takes effect')
    try {
      const res = await record.mutateAsync({
        source, effective_date: effectiveDate, note: note.trim() || undefined,
        source_file_name: result.file_name, source_document_path: result.source_document_path, bills: result.bills,
        adders,  // the current ladder carries forward; change it with the Adders button
      })
      toast.success(`Revision ${res.revision_no} recorded · works total ${money(res.works_total)}`)
      close(false)
    } catch (err) {
      toast.error(getErrorMessage(err))
    }
  }

  return (
    <Dialog open={open} onOpenChange={close}>
      <DialogContent className="sm:max-w-3xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Import bill of quantities</DialogTitle>
          <DialogDescription>
            An .xlsx in the company&apos;s BEME sheet layout (Item · Description · Unit · Contract Qty · Rate · Contract Amount).
            You see what was read before anything is saved. Saving records <strong>revision {nextRevisionNo}</strong>; the previous version stays in the history.
          </DialogDescription>
        </DialogHeader>

        {!result ? (
          <div className="grid gap-4">
            <div className="flex rounded-lg bg-muted p-1 w-fit">
              {([['file', 'Upload a bill file'], ['workbook', 'Use an uploaded weekly workbook']] as const).map(([k, label]) => (
                <button key={k} type="button" onClick={() => setDoor(k)}
                  className={`px-3 py-1.5 text-sm font-medium rounded-md transition-colors ${door === k ? 'bg-primary/20 text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground'}`}>
                  {label}
                </button>
              ))}
            </div>
            {door === 'file' ? (
              <div className="grid gap-2">
                <Label htmlFor="boq-file">Bill file (.xlsx)</Label>
                <Input id="boq-file" type="file" accept=".xlsx,.xlsm" onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
              </div>
            ) : (
              <div className="grid gap-2">
                <Label>Weekly workbook</Label>
                {usable.length === 0 ? (
                  <p className="text-sm text-muted-foreground">This project has no parsed weekly workbook yet.</p>
                ) : (
                  <Select value={submissionId} onValueChange={setSubmissionId}>
                    <SelectTrigger><SelectValue placeholder="Choose a workbook…" /></SelectTrigger>
                    <SelectContent>
                      {usable.map((s) => (
                        <SelectItem key={s.id} value={s.id}>
                          W{String(s.week_number).padStart(2, '0')} {s.year}{s.week_ending_date ? ` · ${s.week_ending_date}` : ''}{s.file_name ? ` · ${s.file_name}` : ''}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}
                <p className="text-xs text-muted-foreground">Only the bill is read from it — item, description, unit, contract quantity, rate, amount. Weekly figures are ignored.</p>
              </div>
            )}
          </div>
        ) : (
          <div className="space-y-4">
            <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm">
              <span className="font-medium">{result.file_name}</span>
              {result.from_week && <span className="text-muted-foreground">from {result.from_week}</span>}
              <span className="text-muted-foreground">sheet &ldquo;{result.sheet}&rdquo;</span>
              <span>{result.bill_count} bills · {result.item_count} items</span>
              <span className="font-semibold tabular-nums">works {money(result.works_total)}</span>
            </div>

            {result.warnings.length > 0 && (
              <div className="rounded-md border border-amber-300 bg-amber-50 p-3 text-xs text-amber-900 dark:border-amber-700 dark:bg-amber-950 dark:text-amber-200">
                <p className="font-medium mb-1">The parser flagged {result.warnings.length} thing{result.warnings.length !== 1 ? 's' : ''}:</p>
                <ul className="list-disc pl-4 space-y-0.5">{result.warnings.map((w, i) => <li key={i}>{w}</li>)}</ul>
              </div>
            )}

            <div className="rounded-lg border overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Code</TableHead><TableHead>Bill</TableHead>
                    <TableHead className="text-right">Items</TableHead>
                    <TableHead className="text-right">Our total</TableHead>
                    <TableHead className="text-right">Sheet total</TableHead>
                    <TableHead className="w-[60px]" />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {result.bills.map((b) => (
                    <TableRow key={b.bill_code}>
                      <TableCell className="tabular-nums">{b.bill_code}</TableCell>
                      <TableCell className="whitespace-normal">{b.name ?? <span className="text-muted-foreground">(no header row)</span>}</TableCell>
                      <TableCell className="text-right tabular-nums">{b.item_count}</TableCell>
                      <TableCell className="text-right tabular-nums">{money(b.items_total)}</TableCell>
                      <TableCell className="text-right tabular-nums">{b.sheet_total != null ? money(b.sheet_total) : <span className="text-muted-foreground">—</span>}</TableCell>
                      <TableCell>
                        {b.matches_sheet === true && <CheckCircle2 className="h-4 w-4 text-emerald-600" aria-label="matches the sheet" />}
                        {b.matches_sheet === false && <Badge variant="outline" className="text-amber-700 border-amber-300">differs</Badge>}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <Label>Effective date</Label>
                <Input type="date" value={effectiveDate} onChange={(e) => setEffectiveDate(e.target.value)} />
              </div>
              <div>
                <Label>What this bill is</Label>
                <Select value={source} onValueChange={(v) => setSource(v as typeof source)}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="award_beme">The award bill</SelectItem>
                    <SelectItem value="variation">A variation</SelectItem>
                    <SelectItem value="correction">A correction</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div>
              <Label>Note</Label>
              <Textarea rows={2} value={note} onChange={(e) => setNote(e.target.value)} placeholder="e.g. BEME as awarded, letter ref …" />
            </div>
          </div>
        )}

        <DialogFooter>
          {result && <Button variant="ghost" onClick={reset}>Choose another file</Button>}
          <Button variant="outline" onClick={() => close(false)}>Cancel</Button>
          {!result
            ? <Button onClick={readFile} disabled={reading || (door === 'file' ? !file : !submissionId)}>{reading ? 'Reading…' : door === 'file' ? 'Read file' : 'Read workbook'}</Button>
            : <Button onClick={save} disabled={record.isPending}>{record.isPending ? 'Saving…' : `Save as revision ${nextRevisionNo}`}</Button>}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
