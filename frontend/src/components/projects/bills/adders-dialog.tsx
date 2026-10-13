'use client'

/**
 * Adders — the ladder under the works total (contingency, VOP, provisional
 * sums, VAT), recorded with the bill as parameters. Admin only.
 *
 * The order is fixed, the way the purchase-order form fixes discount → VAT:
 * provisions apply to the works total first, then tax on the subtotal.
 * Entry order never changes money (backend: bills_summary.order_adders).
 *
 * Exports the field editor and a client-side preview so the bill builder
 * can carry the same section; the dialog on the bill page edits the saved
 * adders of the current revision.
 */

import { useState } from 'react'
import { Plus, Trash2 } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog'
import { useUpdateBillsAdders } from '@/hooks/use-projects'
import type { BoqAdder, BoqAdderKind } from '@/lib/api/projects'
import { getErrorMessage } from '@/lib/api/client'
import { money } from '@/lib/format'

export const KIND_LABEL: Record<BoqAdderKind, string> = {
  percent_of_works: 'Provision · % of works total (contingency, VOP)',
  amount: 'Provision · fixed amount (provisional sum)',
  percent_of_running: 'Tax on the subtotal · VAT (always last)',
}
const KINDS: BoqAdderKind[] = ['percent_of_works', 'amount', 'percent_of_running']

export type AdderRow = { name: string; kind: BoqAdderKind; value: string }

export const rowsFromAdders = (adders: BoqAdder[]): AdderRow[] =>
  adders.map((a) => ({ name: a.name, kind: a.kind, value: String(a.value) }))

/** rows → adders, or the first problem as a message */
export function addersFromRows(rows: AdderRow[]): { adders: BoqAdder[] } | { error: string } {
  for (const [i, r] of rows.entries()) {
    if (!r.name.trim()) return { error: `Adder ${i + 1}: give it a name` }
    if (r.value === '' || Number.isNaN(Number(r.value)) || Number(r.value) < 0) return { error: `Adder ${i + 1} (${r.name}): enter a value` }
  }
  return { adders: rows.map((r) => ({ name: r.name.trim(), kind: r.kind, value: Number(r.value) })) }
}

/** the same ladder the server computes, for a live preview while typing
 *  (provisions on the works total first, then tax on the subtotal) */
export function previewLadder(works: number, rows: AdderRow[]): { lines: { name: string; kind: BoqAdderKind; value: number; amount: number }[]; total: number } {
  const r2 = (x: number) => Math.round(x * 100) / 100
  const valid = rows.filter((r) => r.name.trim() && r.value !== '' && !Number.isNaN(Number(r.value)))
  const ordered = [...valid.filter((r) => r.kind !== 'percent_of_running'), ...valid.filter((r) => r.kind === 'percent_of_running')]
  let running = r2(works)
  const lines = ordered.map((r) => {
    const v = Number(r.value)
    const amount = r.kind === 'percent_of_works' ? r2(works * v / 100) : r.kind === 'percent_of_running' ? r2(running * v / 100) : r2(v)
    running = r2(running + amount)
    return { name: r.name.trim(), kind: r.kind, value: v, amount }
  })
  return { lines, total: running }
}

/** the controlled editor: a row per adder, add / remove, no reordering (order is derived) */
export function AddersFields({ rows, onChange }: { rows: AdderRow[]; onChange: (rows: AdderRow[]) => void }) {
  const update = (i: number, patch: Partial<AdderRow>) => onChange(rows.map((x, j) => (j === i ? { ...x, ...patch } : x)))
  const add = () => onChange([...rows, {
    name: '', value: '',
    // first line: a provision; once a tax exists, more provisions; otherwise offer the tax next
    kind: rows.some((x) => x.kind === 'percent_of_running') ? 'percent_of_works' : (rows.length ? 'percent_of_running' : 'percent_of_works'),
  }])
  return (
    <div className="space-y-2">
      {rows.length === 0 && <p className="text-sm text-muted-foreground">No adders. The contract figure equals the works total.</p>}
      {rows.map((r, i) => (
        <div key={i} className="grid grid-cols-[1fr_auto] gap-2 rounded-md border p-2 sm:grid-cols-[minmax(0,1.6fr)_minmax(0,2fr)_minmax(0,1fr)_auto] sm:items-end">
          <div>
            {i === 0 && <Label className="text-xs">Name</Label>}
            <Input value={r.name} onChange={(e) => update(i, { name: e.target.value })} placeholder="e.g. VAT" />
          </div>
          <div className="col-span-2 sm:col-span-1">
            {i === 0 && <Label className="text-xs">Applied as</Label>}
            <Select value={r.kind} onValueChange={(v) => update(i, { kind: v as BoqAdderKind })}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>{KINDS.map((k) => <SelectItem key={k} value={k}>{KIND_LABEL[k]}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          <div>
            {i === 0 && <Label className="text-xs">{r.kind === 'amount' ? 'Amount (₦)' : 'Rate (%)'}</Label>}
            <Input type="number" step="0.01" min="0" value={r.value} onChange={(e) => update(i, { value: e.target.value })} placeholder={r.kind === 'amount' ? '0.00' : '7.5'} />
          </div>
          <div className="flex items-center justify-end">
            <Button variant="ghost" size="icon" className="h-8 w-8 text-destructive" onClick={() => onChange(rows.filter((_, j) => j !== i))} title="Remove"><Trash2 className="h-4 w-4" /></Button>
          </div>
        </div>
      ))}
      <Button variant="outline" size="sm" onClick={add} disabled={rows.length >= 12}>
        <Plus className="h-3.5 w-3.5 mr-1.5" />Add a line
      </Button>
    </div>
  )
}

/** the live ladder: works total → each adder → contract sum */
export function LadderPreview({ works, rows }: { works: number; rows: AdderRow[] }) {
  const { lines, total } = previewLadder(works, rows)
  return (
    <dl className="grid grid-cols-[1fr_auto] gap-x-6 gap-y-1 rounded-md border bg-muted/30 p-3 text-sm">
      <dt className="font-medium">Works total</dt><dd className="text-right tabular-nums font-medium">{money(works)}</dd>
      {lines.map((l, i) => (
        <div key={i} className="contents">
          <dt className="text-muted-foreground">{l.name}{l.kind === 'amount' ? '' : ` · ${l.value}% ${l.kind === 'percent_of_works' ? 'of works total' : 'of subtotal'}`}</dt>
          <dd className="text-right tabular-nums">{money(l.amount)}</dd>
        </div>
      ))}
      <dt className="border-t pt-1 font-semibold uppercase tracking-wide text-xs">{lines.length ? 'Contract sum' : 'Contract sum (no adders)'}</dt>
      <dd className="border-t pt-1 text-right tabular-nums font-semibold">{money(total)}</dd>
    </dl>
  )
}

export const ORDER_NOTE = 'The order is fixed, the way the purchase-order form fixes discount and VAT: provisions apply to the works total first, then tax applies to the subtotal. Enter them in any order — the money comes out the same.'

// ── the dialog on the bill page: edits the saved adders of the current revision ──

export function AddersDialog({ projectId, open, onOpenChange, adders, worksTotal = 0 }: {
  projectId: string; open: boolean; onOpenChange: (v: boolean) => void; adders: BoqAdder[]; worksTotal?: number
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      {/* the form mounts fresh each time the dialog opens, so its rows start from the saved adders */}
      {open && <AddersForm projectId={projectId} adders={adders} worksTotal={worksTotal} onOpenChange={onOpenChange} />}
    </Dialog>
  )
}

function AddersForm({ projectId, adders, worksTotal, onOpenChange }: {
  projectId: string; adders: BoqAdder[]; worksTotal: number; onOpenChange: (v: boolean) => void
}) {
  const mutation = useUpdateBillsAdders(projectId)
  const [rows, setRows] = useState<AdderRow[]>(() => rowsFromAdders(adders))

  const save = async () => {
    const parsed = addersFromRows(rows)
    if ('error' in parsed) return toast.error(parsed.error)
    try {
      await mutation.mutateAsync(parsed.adders)
      toast.success(rows.length ? `${rows.length} adder${rows.length !== 1 ? 's' : ''} saved` : 'Adders cleared')
      onOpenChange(false)
    } catch (err) {
      toast.error(getErrorMessage(err))
    }
  }

  return (
    <DialogContent className="sm:max-w-2xl">
      <DialogHeader>
        <DialogTitle>Adders under the works total</DialogTitle>
        <DialogDescription>{ORDER_NOTE}</DialogDescription>
      </DialogHeader>
      <AddersFields rows={rows} onChange={setRows} />
      <LadderPreview works={worksTotal} rows={rows} />
      <DialogFooter>
        <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
        <Button onClick={save} disabled={mutation.isPending}>{mutation.isPending ? 'Saving…' : 'Save adders'}</Button>
      </DialogFooter>
    </DialogContent>
  )
}
