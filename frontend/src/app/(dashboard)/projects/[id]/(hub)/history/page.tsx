'use client'

/**
 * Timeline — the project's dated facts (PRD v2 §3.2–3.3, §7):
 * contract sums and status events, newest first, each with who and when.
 * Admins add rows here; nothing is ever edited or deleted (the database
 * refuses), so a mistake is a 'correction' row with a note.
 *
 * 2026-10-12: a project is Ongoing or Archived. 'Move to Archive' records
 * status 'closed'; 'Return to Ongoing' records 'active'. Both are dated,
 * so a report for any period still sees the project as it was then.
 * The finer lifecycle stays available under 'Change status'.
 */

import { useParams } from 'next/navigation'
import { useState } from 'react'
import { toast } from 'sonner'
import { Archive, ArchiveRestore, Banknote, Flag, Plus, FileText } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Card, CardContent } from '@/components/ui/card'
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { useAuth } from '@/providers/auth-provider'
import { useAddContractSum, useAddStatusEvent, useProject, useProjectHistory } from '@/hooks/use-projects'
import type { ContractSumBasis, ContractSumKind, HistoryEntry, ProjectStatus } from '@/lib/api/projects'
import { STATUS_STYLES } from '@/components/projects/project-status'
import { getErrorMessage } from '@/lib/api/client'
import { fmtDate, money } from '@/lib/format'

const KIND_LABEL: Record<ContractSumKind, string> = {
  original: 'Original contract sum',
  variation: 'Variation',
  revision: 'Revised contract sum',
  correction: 'Correction',
}
const BASIS_LABEL: Record<ContractSumBasis, string> = {
  all_in: 'all-in (incl. provisions & VAT)',
  ex_vat: 'ex-VAT',
  unknown: 'basis unknown',
}
const STATUS_ORDER: ProjectStatus[] = [
  'awarded', 'mobilised', 'active', 'suspended', 'substantially_complete', 'finally_complete', 'closed',
]
/** the two buckets the register speaks in; the lifecycle value is the detail */
const ONGOING_STATUSES: ReadonlySet<string> = new Set(['awarded', 'mobilised', 'active', 'suspended'])
const bucketOf = (status: string) => (ONGOING_STATUSES.has(status) ? 'Ongoing' : 'Archived')

export default function ProjectHistoryPage() {
  const { id } = useParams<{ id: string }>()
  const { user } = useAuth()
  const isAdmin = user?.role === 'admin'
  const { data: project } = useProject(id)
  const { data: entries, isLoading } = useProjectHistory(id)
  const [sumOpen, setSumOpen] = useState(false)
  const [statusOpen, setStatusOpen] = useState(false)
  const [moveOpen, setMoveOpen] = useState(false)
  const isOngoing = project ? ONGOING_STATUSES.has(project.status) : true

  const hasOriginal = entries?.some((e) => e.entry_type === 'contract_sum' && e.label === 'original') ?? false

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold">Timeline</h2>
          <p className="text-sm text-muted-foreground">
            Every contract sum and every move between Ongoing and Archive, dated, with who recorded it and when.
            Rows are never edited — a mistake is corrected by a new row that says so.
          </p>
        </div>
        {isAdmin && (
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" size="sm" onClick={() => setMoveOpen(true)}>
              {isOngoing
                ? <><Archive className="mr-2 h-4 w-4" /> Move to Archive</>
                : <><ArchiveRestore className="mr-2 h-4 w-4" /> Return to Ongoing</>}
            </Button>
            <Button variant="ghost" size="sm" onClick={() => setStatusOpen(true)}>
              <Flag className="mr-2 h-4 w-4" /> Change status
            </Button>
            <Button size="sm" onClick={() => setSumOpen(true)}>
              <Plus className="mr-2 h-4 w-4" /> Record contract sum
            </Button>
          </div>
        )}
      </div>

      {isLoading ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : !entries?.length ? (
        <Card><CardContent className="p-6 text-sm text-muted-foreground">No history yet.</CardContent></Card>
      ) : (
        <ol className="relative ml-3 border-l">
          {entries.map((e) => <HistoryRow key={`${e.entry_type}-${e.id}`} e={e} />)}
        </ol>
      )}

      {isAdmin && project && (
        <>
          <ContractSumDialog projectId={id} open={sumOpen} onOpenChange={setSumOpen}
            hasOriginal={hasOriginal} currentSum={project.current_contract_sum} />
          <StatusDialog projectId={id} open={statusOpen} onOpenChange={setStatusOpen}
            currentStatus={project.status} />
          <MoveDialog projectId={id} open={moveOpen} onOpenChange={setMoveOpen}
            currentStatus={project.status} toOngoing={!isOngoing} />
        </>
      )}
    </div>
  )
}

function HistoryRow({ e }: { e: HistoryEntry }) {
  const isSum = e.entry_type === 'contract_sum'
  const style = !isSum ? (STATUS_STYLES[e.label] || STATUS_STYLES.active) : null
  return (
    <li className="mb-6 ml-6">
      <span className={`absolute -left-3 flex h-6 w-6 items-center justify-center rounded-full border bg-background ${
        e.is_current ? 'border-primary text-primary' : 'text-muted-foreground'}`}>
        {isSum ? <Banknote className="h-3.5 w-3.5" /> : <Flag className="h-3.5 w-3.5" />}
      </span>
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <span className="text-sm font-medium">
          {isSum ? KIND_LABEL[e.label as ContractSumKind] ?? e.label : `${bucketOf(e.label)} · ${style?.label ?? e.label}`}
        </span>
        <span className="text-xs text-muted-foreground">effective {fmtDate(e.effective_date)}</span>
        {e.is_current && <Badge variant="outline" className="text-[10px]">current</Badge>}
      </div>
      {isSum && (
        <div className="mt-1 text-sm tabular-nums">
          <span className="font-semibold">{money(e.amount ?? 0)}</span>
          {e.delta != null && e.label !== 'original' && (
            <span className={`ml-2 text-xs ${e.delta >= 0 ? 'text-emerald-700' : 'text-red-700'}`}>
              {e.delta >= 0 ? '+' : ''}{money(e.delta)}
            </span>
          )}
          <span className="ml-2 text-xs text-muted-foreground">{BASIS_LABEL[(e.basis ?? 'unknown') as ContractSumBasis]}</span>
        </div>
      )}
      {(e.instrument_ref || e.document_path) && (
        <div className="mt-1 flex items-center gap-1 text-xs text-muted-foreground">
          <FileText className="h-3 w-3" />
          {e.instrument_ref ?? 'document attached'}
        </div>
      )}
      {e.note && <p className="mt-1 text-xs text-muted-foreground">{e.note}</p>}
      <p className="mt-1 text-[11px] text-muted-foreground/70">
        recorded {fmtDate(e.created_at.slice(0, 10))} by {e.created_by_name || e.created_by_email || 'system'}
      </p>
    </li>
  )
}

function ContractSumDialog({ projectId, open, onOpenChange, hasOriginal, currentSum }: {
  projectId: string; open: boolean; onOpenChange: (v: boolean) => void
  hasOriginal: boolean; currentSum: number | null
}) {
  const mutation = useAddContractSum(projectId)
  const [kind, setKind] = useState<ContractSumKind>(hasOriginal ? 'variation' : 'original')
  const [amount, setAmount] = useState('')
  const [basis, setBasis] = useState<ContractSumBasis>('all_in')
  const [effectiveDate, setEffectiveDate] = useState('')
  const [instrument, setInstrument] = useState('')
  const [note, setNote] = useState('')

  const submit = async () => {
    const value = Number(amount)
    if (!amount || Number.isNaN(value) || value < 0) return toast.error('Enter the resulting contract sum')
    if (!effectiveDate) return toast.error('Enter the effective date')
    if (kind === 'correction' && !note.trim()) return toast.error('A correction must say what it corrects')
    try {
      const res = await mutation.mutateAsync({
        kind, amount: value, basis, effective_date: effectiveDate,
        instrument_ref: instrument.trim() || undefined, note: note.trim() || undefined,
      })
      toast.success(`Recorded. Current contract sum: ${money(res.current_contract_sum)}`)
      onOpenChange(false)
      setAmount(''); setInstrument(''); setNote('')
    } catch (err) {
      toast.error(getErrorMessage(err))
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Record contract sum</DialogTitle>
          <DialogDescription>
            Enter the <strong>resulting</strong> contract sum after this instrument (not the change).
            {currentSum != null && <> Current: {money(currentSum)}.</>}
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-4">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label>Kind</Label>
              <Select value={kind} onValueChange={(v) => setKind(v as ContractSumKind)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {(Object.keys(KIND_LABEL) as ContractSumKind[])
                    .filter((k) => (k === 'original' ? !hasOriginal : hasOriginal))
                    .map((k) => <SelectItem key={k} value={k}>{KIND_LABEL[k]}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Basis</Label>
              <Select value={basis} onValueChange={(v) => setBasis(v as ContractSumBasis)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all_in">All-in (incl. provisions & VAT)</SelectItem>
                  <SelectItem value="ex_vat">Ex-VAT</SelectItem>
                  <SelectItem value="unknown">Unknown</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label>Resulting sum (₦)</Label>
              <Input type="number" step="0.01" min="0" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="e.g. 14621359979.09" />
            </div>
            <div>
              <Label>Effective date</Label>
              <Input type="date" value={effectiveDate} onChange={(e) => setEffectiveDate(e.target.value)} />
            </div>
          </div>
          <div>
            <Label>Instrument reference</Label>
            <Input value={instrument} onChange={(e) => setInstrument(e.target.value)} placeholder="e.g. VO-02 / letter ref" />
          </div>
          <div>
            <Label>Note{kind === 'correction' ? ' (required)' : ''}</Label>
            <Textarea value={note} onChange={(e) => setNote(e.target.value)} rows={2} />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={submit} disabled={mutation.isPending}>Record</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

/** Move to Archive (-> closed) or Return to Ongoing (-> active), dated */
function MoveDialog({ projectId, open, onOpenChange, currentStatus, toOngoing }: {
  projectId: string; open: boolean; onOpenChange: (v: boolean) => void; currentStatus: ProjectStatus; toOngoing: boolean
}) {
  const mutation = useAddStatusEvent(projectId)
  const [effectiveDate, setEffectiveDate] = useState('')
  const [note, setNote] = useState('')
  const target: ProjectStatus = toOngoing ? 'active' : 'closed'
  const title = toOngoing ? 'Return to Ongoing' : 'Move to Archive'

  const submit = async () => {
    if (!effectiveDate) return toast.error('Enter the date the move takes effect')
    try {
      const res = await mutation.mutateAsync({ status: target, effective_date: effectiveDate, note: note.trim() || undefined })
      toast.success(`${bucketOf(res.status)} since ${fmtDate(res.status_since)}`)
      onOpenChange(false); setNote(''); setEffectiveDate('')
    } catch (err) {
      toast.error(getErrorMessage(err))
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>
            Currently <strong>{bucketOf(currentStatus)}</strong> ({STATUS_STYLES[currentStatus]?.label ?? currentStatus}).
            The move is recorded with its date and stays on the timeline; reports for earlier periods still see the project as it was then.
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-4">
          <div>
            <Label>Effective date</Label>
            <Input type="date" value={effectiveDate} onChange={(e) => setEffectiveDate(e.target.value)} />
          </div>
          <div>
            <Label>Note</Label>
            <Textarea value={note} onChange={(e) => setNote(e.target.value)} rows={2}
              placeholder={toOngoing ? 'e.g. works resumed after suspension' : 'e.g. final certificate issued'} />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={submit} disabled={mutation.isPending}>{title}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function StatusDialog({ projectId, open, onOpenChange, currentStatus }: {
  projectId: string; open: boolean; onOpenChange: (v: boolean) => void; currentStatus: ProjectStatus
}) {
  const mutation = useAddStatusEvent(projectId)
  const [status, setStatus] = useState<ProjectStatus>('active')
  const [effectiveDate, setEffectiveDate] = useState('')
  const [note, setNote] = useState('')

  const submit = async () => {
    if (!effectiveDate) return toast.error('Enter the effective date')
    try {
      const res = await mutation.mutateAsync({ status, effective_date: effectiveDate, note: note.trim() || undefined })
      toast.success(`Status is now ${STATUS_STYLES[res.status]?.label ?? res.status} since ${fmtDate(res.status_since)}`)
      onOpenChange(false); setNote('')
    } catch (err) {
      toast.error(getErrorMessage(err))
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Change status</DialogTitle>
          <DialogDescription>
            Currently <strong>{STATUS_STYLES[currentStatus]?.label ?? currentStatus}</strong>. Backdating is allowed;
            the move is checked against the status as at that date.
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-4">
          <div>
            <Label>New status</Label>
            <Select value={status} onValueChange={(v) => setStatus(v as ProjectStatus)}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {STATUS_ORDER.map((s) => <SelectItem key={s} value={s}>{STATUS_STYLES[s]?.label ?? s}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label>Effective date</Label>
            <Input type="date" value={effectiveDate} onChange={(e) => setEffectiveDate(e.target.value)} />
          </div>
          <div>
            <Label>Note</Label>
            <Textarea value={note} onChange={(e) => setNote(e.target.value)} rows={2} placeholder="e.g. practical completion certificate issued" />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={submit} disabled={mutation.isPending}>Record</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
