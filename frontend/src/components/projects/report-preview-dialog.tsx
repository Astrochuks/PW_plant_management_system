'use client'

/**
 * Upload preview — every sheet of the workbook rendered for review
 * BEFORE anything touches the database. Parsed sheets show typed rows,
 * cross-checks and warnings; stored-only sheets show a raw grid.
 */

import { useMemo, useState } from 'react'
import {
  AlertTriangle, CheckCircle2, FileSpreadsheet, Loader2, ShieldAlert,
} from 'lucide-react'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
} from '@/components/ui/dialog'
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table'
import type { ReportPreview, SheetPreview } from '@/hooks/use-projects'

const ngn = (v: number | null | undefined) =>
  v == null ? '—' : `₦${Number(v).toLocaleString('en-NG', { maximumFractionDigits: 2 })}`

const SHEET_ORDER = [
  'Contract Summary', 'BEME & Works Completed Fd', 'Cost Report',
  'Plant Return', 'Diesel Consumption', 'Certificate Status',
  'Payments Recieved', 'Weekly Summary', 'Lists',
  'Bill 1 Summary', 'Bill 1 Payments', 'Subcontractors',
  'Labour Strength', 'Materials & Civils', 'Hired Vehicles', 'Precast',
]

function StatusDot({ sheet }: { sheet: SheetPreview }) {
  if (sheet.kind === 'stored_only') {
    return <span className="h-2 w-2 shrink-0 rounded-full bg-slate-300" />
  }
  if (sheet.status === 'failed') {
    return <span className="h-2 w-2 shrink-0 rounded-full bg-red-500" />
  }
  if (sheet.warnings.length > 0) {
    return <span className="h-2 w-2 shrink-0 rounded-full bg-amber-500" />
  }
  return <span className="h-2 w-2 shrink-0 rounded-full bg-emerald-500" />
}

function RowsTable({ rows }: { rows: Record<string, unknown>[] }) {
  const columns = useMemo(() => {
    if (!rows.length) return []
    const keys = Object.keys(rows[0]).filter((k) => !k.startsWith('_'))
    return keys.slice(0, 12)
  }, [rows])
  if (!rows.length) {
    return <p className="text-muted-foreground p-4 text-sm">No rows.</p>
  }
  return (
    <Table>
      <TableHeader>
        <TableRow>
          {columns.map((c) => (
            <TableHead key={c} className="whitespace-nowrap text-xs">
              {c.replace(/_/g, ' ')}
            </TableHead>
          ))}
        </TableRow>
      </TableHeader>
      <TableBody>
        {rows.map((r, i) => (
          <TableRow key={i}>
            {columns.map((c) => {
              const v = r[c]
              const isNum = typeof v === 'number'
              return (
                <TableCell
                  key={c}
                  className={`text-xs ${isNum ? 'text-right tabular-nums' : ''} max-w-[260px]`}
                >
                  <span className="line-clamp-2">
                    {v == null || v === '' ? '—'
                      : isNum ? Number(v).toLocaleString('en-NG')
                      : String(v)}
                  </span>
                </TableCell>
              )
            })}
          </TableRow>
        ))}
      </TableBody>
    </Table>
  )
}

function GridTable({ grid }: { grid: string[][] }) {
  if (!grid.length) {
    return <p className="text-muted-foreground p-4 text-sm">Sheet is empty.</p>
  }
  return (
    <Table>
      <TableBody>
        {grid.map((row, i) => (
          <TableRow key={i}>
            {row.map((cell, j) => (
              <TableCell key={j} className="max-w-[200px] px-2 py-1 text-xs">
                <span className="line-clamp-1">{cell}</span>
              </TableCell>
            ))}
          </TableRow>
        ))}
      </TableBody>
    </Table>
  )
}

function SheetExtras({ name, sheet }: { name: string; sheet: SheetPreview }) {
  return (
    <div className="space-y-3">
      {/* BEME: per-bill totals + tail */}
      {sheet.bills && sheet.bills.length > 0 && (
        <div className="rounded-lg border p-3">
          <p className="mb-2 text-xs font-semibold">Bills (sheet totals as cross-checks)</p>
          <div className="grid gap-1 text-xs sm:grid-cols-2">
            {sheet.bills.map((b) => {
              const broken = sheet.cross_checks?.some(
                (c) => c.check === `bill_${b.bill_no}_contract`)
              return (
                <div key={b.bill_no} className="flex items-center justify-between gap-2">
                  <span className="truncate">{b.bill_no}. {b.name}</span>
                  <span className={`tabular-nums ${broken ? 'text-amber-600 font-medium' : 'text-muted-foreground'}`}>
                    {ngn(b.sheet_total_contract)}{broken ? ' ⚠' : ''}
                  </span>
                </div>
              )
            })}
          </div>
          {sheet.tail?.grand_total && (
            <p className="text-muted-foreground mt-2 text-xs">
              Grand total (works + 5% contingency/VOP + 7.5% VAT):{' '}
              <span className="tabular-nums font-medium">{ngn(sheet.tail.grand_total.contract)}</span>
            </p>
          )}
        </div>
      )}

      {/* Cost Report: sheet total */}
      {sheet.sheet_total?.this_week != null && (
        <div className="rounded-lg border p-3 text-xs">
          <span className="font-semibold">Sheet total this week: </span>
          <span className="tabular-nums">{ngn(sheet.sheet_total.this_week)}</span>
          <span className="text-muted-foreground"> — recomputed from category rows and verified</span>
        </div>
      )}

      {/* Plant Return: footer */}
      {sheet.footer?.total_all != null && (
        <div className="rounded-lg border p-3 text-xs">
          <span className="font-semibold">Footer: </span>
          <span className="tabular-nums">TOTAL All {ngn(sheet.footer.total_all)}</span>
          {(sheet.footer.adjustments?.length ?? 0) > 0 && (
            <span className="text-muted-foreground">
              {' '}− consumables ({sheet.footer.adjustments!.map((a) => a.label).join(', ')})
              {' '}→ posts to Cost Report as Plant Internal
            </span>
          )}
        </div>
      )}

      {/* Diesel: stock + totals */}
      {sheet.stock && (
        <div className="rounded-lg border p-3 text-xs">
          <span className="font-semibold">Stock line: </span>
          <span className="text-muted-foreground">
            opening {sheet.stock.opening ?? '—'} · received {sheet.stock.received ?? '—'} ·
            used {sheet.stock.used ?? '—'} · closing {sheet.stock.closing ?? '—'}
          </span>
          {sheet.sheet_totals?.all_used != null && (
            <span> · total used {Number(sheet.sheet_totals.all_used).toLocaleString()}L</span>
          )}
        </div>
      )}

      {/* Contract Summary: snapshot fields */}
      {sheet.snapshot && (
        <div className="rounded-lg border p-3">
          <div className="grid gap-1 text-xs sm:grid-cols-2">
            {Object.entries(sheet.snapshot)
              .filter(([, v]) => v != null)
              .map(([k, v]) => (
                <div key={k} className="flex justify-between gap-2">
                  <span className="text-muted-foreground">{k.replace(/_/g, ' ')}</span>
                  <span className="tabular-nums truncate">
                    {typeof v === 'number' ? Number(v).toLocaleString('en-NG') : String(v)}
                  </span>
                </div>
              ))}
          </div>
        </div>
      )}

      {/* warnings */}
      {sheet.warnings.length > 0 && (
        <div className="space-y-1 rounded-lg border border-amber-300 bg-amber-50 p-3">
          {sheet.warnings.map((w) => (
            <p key={w} className="flex items-start gap-1.5 text-xs text-amber-800">
              <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0" /> {w}
            </p>
          ))}
        </div>
      )}
    </div>
  )
}

export function ReportPreviewDialog({
  preview, fileName, open, onOpenChange, onConfirm, confirming,
}: {
  preview: ReportPreview | null
  fileName: string
  open: boolean
  onOpenChange: (o: boolean) => void
  onConfirm: () => void
  confirming: boolean
}) {
  const [active, setActive] = useState('Contract Summary')
  if (!preview) return null

  const names = SHEET_ORDER.filter((n) => preview.sheets[n])
  const sheet = preview.sheets[active]
  const totalWarnings = names.reduce(
    (n, s) => n + preview.sheets[s].warnings.length, 0)

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex h-[90vh] max-w-[95vw] flex-col gap-3 lg:max-w-6xl">
        <DialogHeader className="shrink-0">
          <DialogTitle className="flex flex-wrap items-center gap-2 text-base">
            <FileSpreadsheet className="h-4 w-4" />
            Preview — {fileName}
            {preview.drift.clean
              ? <Badge variant="secondary" className="bg-emerald-100 text-emerald-700">all 16 sheets present</Badge>
              : <Badge variant="secondary" className="bg-red-100 text-red-700">
                  missing: {preview.drift.missing.join(', ')}
                </Badge>}
            {totalWarnings > 0 && (
              <Badge variant="secondary" className="bg-amber-100 text-amber-800">
                {totalWarnings} warning{totalWarnings === 1 ? '' : 's'}
              </Badge>
            )}
          </DialogTitle>
        </DialogHeader>

        {preview.identity_warning && (
          <div className="flex shrink-0 items-center gap-2 rounded-lg border border-red-300 bg-red-50 p-2.5 text-sm text-red-800">
            <ShieldAlert className="h-4 w-4 shrink-0" /> {preview.identity_warning}
          </div>
        )}

        <div className="flex min-h-0 flex-1 gap-3">
          {/* sheet list */}
          <div className="w-48 shrink-0 overflow-y-auto rounded-lg border">
            <div className="p-1.5">
              {names.map((n) => {
                const s = preview.sheets[n]
                return (
                  <button
                    key={n}
                    onClick={() => setActive(n)}
                    className={`flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-xs transition-colors ${
                      active === n ? 'bg-primary/10 font-medium' : 'hover:bg-muted'
                    }`}
                  >
                    <StatusDot sheet={s} />
                    <span className="truncate">{n}</span>
                  </button>
                )
              })}
            </div>
          </div>

          {/* active sheet */}
          <div className="flex min-w-0 flex-1 flex-col gap-2">
            <div className="flex shrink-0 flex-wrap items-center gap-2">
              <span className="text-sm font-semibold">{active}</span>
              {sheet.kind === 'stored_only' ? (
                <Badge variant="outline" className="text-[10px]">
                  stored for reference — not parsed (data auto-posts to Cost Report)
                </Badge>
              ) : (
                <Badge variant="outline" className="text-[10px]">
                  {sheet.total_rows ?? 0} rows parsed
                  {typeof sheet.calendar_weeks === 'number'
                    ? ` · ${sheet.calendar_weeks} calendar weeks` : ''}
                </Badge>
              )}
            </div>
            <div className="min-h-0 flex-1 overflow-auto rounded-lg border">
              <div className="space-y-3 p-3">
                <SheetExtras name={active} sheet={sheet} />
                {sheet.kind === 'stored_only'
                  ? <GridTable grid={sheet.grid ?? []} />
                  : sheet.rows && sheet.rows.length > 0 && <RowsTable rows={sheet.rows} />}
                {sheet.kind === 'parsed' && (sheet.total_rows ?? 0) > (sheet.rows?.length ?? 0) && (
                  <p className="text-muted-foreground text-xs">
                    Showing first {sheet.rows?.length} of {sheet.total_rows} rows.
                  </p>
                )}
              </div>
            </div>
          </div>
        </div>

        <div className="flex shrink-0 flex-wrap items-center justify-end gap-2 border-t pt-3">
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={onConfirm} disabled={confirming}>
            {confirming
              ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />
              : <CheckCircle2 className="mr-1.5 h-4 w-4" />}
            Confirm &amp; Ingest
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
