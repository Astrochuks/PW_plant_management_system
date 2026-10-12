'use client'

/**
 * Adders — the ladder under the works total (contingency, VOP, VAT …),
 * recorded with the bill as ordered parameters. Admin only. Each line:
 * a name, how it is applied, a value. Order matters: a percentage of the
 * running subtotal includes every line above it.
 */

import { useState } from 'react'
import { ArrowDown, ArrowUp, Plus, Trash2 } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog'
import { useRecordBillsRevision, useUpdateBillsAdders } from '@/hooks/use-projects'
import type { BoqAdder, BoqAdderKind, BoqBill } from '@/lib/api/projects'
import { getErrorMessage } from '@/lib/api/client'

const KIND_LABEL: Record<BoqAdderKind, string> = {
  percent_of_works: '% of works total',
  percent_of_running: '% of the subtotal above',
  amount: 'fixed amount (₦)',
}

const KINDS: BoqAdderKind[] = ['percent_of_works', 'percent_of_running', 'amount']

type Row = { name: string; kind: BoqAdderKind; value: string }

export function AddersDialog({ projectId, open, onOpenChange, adders, locked = false, bills = [] }: {
  projectId: string; open: boolean; onOpenChange: (v: boolean) => void; adders: BoqAdder[]
  /** in use: the change goes to the project manager as a new revision */
  locked?: boolean; bills?: BoqBill[]
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      {/* the form mounts fresh each time the dialog opens, so its rows start from the saved adders */}
      {open && <AddersForm projectId={projectId} adders={adders} onOpenChange={onOpenChange} locked={locked} bills={bills} />}
    </Dialog>
  )
}

function AddersForm({ projectId, adders, onOpenChange, locked, bills }: {
  projectId: string; adders: BoqAdder[]; onOpenChange: (v: boolean) => void; locked: boolean; bills: BoqBill[]
}) {
  const mutation = useUpdateBillsAdders(projectId)
  const record = useRecordBillsRevision(projectId)
  const [rows, setRows] = useState<Row[]>(() => adders.map((a) => ({ name: a.name, kind: a.kind, value: String(a.value) })))

  const update = (i: number, patch: Partial<Row>) => setRows((r) => r.map((x, j) => (j === i ? { ...x, ...patch } : x)))
  const move = (i: number, d: -1 | 1) => setRows((r) => {
    const j = i + d
    if (j < 0 || j >= r.length) return r
    const next = [...r]; [next[i], next[j]] = [next[j], next[i]]; return next
  })

  const save = async () => {
    for (const [i, r] of rows.entries()) {
      if (!r.name.trim()) return toast.error(`Line ${i + 1}: give it a name`)
      if (r.value === '' || Number.isNaN(Number(r.value)) || Number(r.value) < 0) return toast.error(`Line ${i + 1} (${r.name}): enter a value`)
    }
    const next = rows.map((r) => ({ name: r.name.trim(), kind: r.kind, value: Number(r.value) }))
    try {
      if (locked) {
        // the bill is in use: the same bill with new adders becomes a pending revision
        const res = await record.mutateAsync({
          source: 'correction', effective_date: new Date().toISOString().slice(0, 10),
          note: 'adders changed', bills, adders: next,
        })
        toast.success(`Revision ${res.revision_no} sent to the project manager for approval`)
      } else {
        await mutation.mutateAsync(next)
        toast.success(rows.length ? `${rows.length} adder${rows.length !== 1 ? 's' : ''} saved` : 'Adders cleared')
      }
      onOpenChange(false)
    } catch (err) {
      toast.error(getErrorMessage(err))
    }
  }

  return (
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Adders under the works total</DialogTitle>
          <DialogDescription>
            Applied in order, top to bottom. &ldquo;% of the subtotal above&rdquo; includes every line before it — the usual place for VAT.
            {locked && ' This bill is in use, so saving sends the change to the project manager for approval.'}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-2">
          {rows.length === 0 && <p className="text-sm text-muted-foreground">No adders. The contract figure equals the works total.</p>}
          {rows.map((r, i) => (
            <div key={i} className="grid grid-cols-[1fr_auto] gap-2 rounded-md border p-2 sm:grid-cols-[minmax(0,2fr)_minmax(0,1.6fr)_minmax(0,1fr)_auto] sm:items-end">
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
              <div className="flex items-center gap-1 justify-end">
                <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => move(i, -1)} disabled={i === 0} title="Move up"><ArrowUp className="h-4 w-4" /></Button>
                <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => move(i, 1)} disabled={i === rows.length - 1} title="Move down"><ArrowDown className="h-4 w-4" /></Button>
                <Button variant="ghost" size="icon" className="h-8 w-8 text-destructive" onClick={() => setRows((x) => x.filter((_, j) => j !== i))} title="Remove"><Trash2 className="h-4 w-4" /></Button>
              </div>
            </div>
          ))}
          <Button variant="outline" size="sm" onClick={() => setRows((r) => [...r, { name: '', kind: r.length ? 'percent_of_running' : 'percent_of_works', value: '' }])} disabled={rows.length >= 12}>
            <Plus className="h-3.5 w-3.5 mr-1.5" />Add a line
          </Button>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={save} disabled={mutation.isPending || record.isPending}>{mutation.isPending || record.isPending ? 'Saving…' : locked ? 'Send for approval' : 'Save adders'}</Button>
        </DialogFooter>
      </DialogContent>
  )
}
