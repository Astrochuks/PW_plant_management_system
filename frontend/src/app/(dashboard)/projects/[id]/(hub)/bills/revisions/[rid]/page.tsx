'use client'

/**
 * Review a bill revision — what the project manager reads before deciding
 * (PRD v2 §6; decision 2026-10-12). Three cards, the item-level difference
 * against the bill in force, then the proposed bill in full. A pending
 * revision shows Approve / Reject to a project manager; everyone else
 * reads. Nothing here recomputes money — figures come from the server.
 */

import { useState } from 'react'
import Link from 'next/link'
import { useParams, useRouter } from 'next/navigation'
import { ArrowLeft, Check, X } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Skeleton } from '@/components/ui/skeleton'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog'
import { MiniKpi, MiniKpiRow } from '@/components/shared/mini-kpi'
import { useAuth } from '@/providers/auth-provider'
import { useApproveBillsRevision, useBillsRevision, useRejectBillsRevision } from '@/hooks/use-projects'
import { isProjectManagerRole } from '@/lib/roles'
import { getErrorMessage } from '@/lib/api/client'
import { fmtDate, money, num } from '@/lib/format'
import { BoqSummaryTable } from '@/components/projects/bills/summary-table'

const HEAD = 'text-[#101415] font-semibold text-xs uppercase tracking-wider border-x border-[#e6ac31]/50 whitespace-nowrap'
const CELL = 'text-sm border-x border-border/50 align-top py-2'
const STATE_LABEL: Record<string, string> = { pending: 'Awaiting approval', approved: 'Approved', rejected: 'Rejected', superseded: 'Superseded' }

const fmtTriple = (m: { contract_qty: number | null; rate: number | null; contract_amount: number | null } | undefined) =>
  m ? `${m.contract_qty == null ? '—' : num(m.contract_qty)} × ${m.rate == null ? '—' : money(m.rate)} = ${m.contract_amount == null ? '—' : money(m.contract_amount)}` : '—'

export default function BillRevisionReviewPage() {
  const { id, rid } = useParams<{ id: string; rid: string }>()
  const router = useRouter()
  const { user } = useAuth()
  const canDecide = isProjectManagerRole(user?.role)
  const { data, isLoading } = useBillsRevision(id, rid)
  const approve = useApproveBillsRevision(id, rid)
  const reject = useRejectBillsRevision(id, rid)
  const [rejectOpen, setRejectOpen] = useState(false)
  const [approveOpen, setApproveOpen] = useState(false)
  const [note, setNote] = useState('')

  if (isLoading || !data) return <Skeleton className="h-64" />
  const { revision: rev, bills, summary, diff, current_revision_no } = data
  const changes = diff ? diff.items_changed.length + diff.items_added.length + diff.items_removed.length : 0

  const doApprove = async () => {
    try {
      await approve.mutateAsync(note.trim() || undefined)
      toast.success(`Revision ${rev.revision_no} approved — it is now the bill in force`)
      router.push(`/projects/${id}/bills`)
    } catch (err) { toast.error(getErrorMessage(err)) }
  }
  const doReject = async () => {
    if (note.trim().length < 3) return toast.error('Say why it is rejected')
    try {
      await reject.mutateAsync(note.trim())
      toast.success(`Revision ${rev.revision_no} rejected`)
      router.push(`/projects/${id}/bills`)
    } catch (err) { toast.error(getErrorMessage(err)) }
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="text-lg font-semibold">Bill revision {rev.revision_no}</h2>
            <Badge variant={rev.state === 'pending' ? 'default' : rev.state === 'rejected' ? 'destructive' : 'secondary'}>
              {STATE_LABEL[rev.state] ?? rev.state}
            </Badge>
          </div>
          <p className="text-sm text-muted-foreground">
            Proposed by {rev.proposed_by_name || rev.proposed_by_email || 'admin'}{rev.proposed_at ? ` on ${fmtDate(rev.proposed_at.slice(0, 10))}` : ''}
            {' · '}effective {fmtDate(rev.effective_date)}{rev.source_file_name ? ` · ${rev.source_file_name}` : ''}
          </p>
          {rev.note && <p className="mt-1 text-sm">Note: {rev.note}</p>}
          {rev.decision_note && rev.state !== 'pending' && (
            <p className="mt-1 text-sm">{rev.state === 'rejected' ? 'Rejected' : 'Approved'} by {rev.decided_by_name || rev.decided_by_email}: {rev.decision_note}</p>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button variant="outline" size="sm" asChild>
            <Link href={`/projects/${id}/bills`}><ArrowLeft className="h-3.5 w-3.5 mr-1.5" />Back to the bill</Link>
          </Button>
          {canDecide && rev.state === 'pending' && (
            <>
              <Button variant="outline" size="sm" className="text-destructive hover:text-destructive" onClick={() => { setNote(''); setRejectOpen(true) }}>
                <X className="h-3.5 w-3.5 mr-1.5" />Reject
              </Button>
              <Button size="sm" onClick={() => { setNote(''); setApproveOpen(true) }}>
                <Check className="h-3.5 w-3.5 mr-1.5" />Approve
              </Button>
            </>
          )}
        </div>
      </div>

      <MiniKpiRow>
        <MiniKpi label="Works total proposed" value={money(summary.works_total)} />
        {diff ? (
          <MiniKpi label={`Change vs revision ${current_revision_no}`} value={`${diff.works_delta >= 0 ? '+' : '−'}${money(Math.abs(diff.works_delta))}`} />
        ) : (
          <MiniKpi label="Contract sum" value={money(summary.contract_total)} />
        )}
        <MiniKpi label="Items changed" value={changes.toLocaleString()} />
      </MiniKpiRow>

      {diff && (
        <div className="rounded-lg border-2 border-border overflow-x-auto">
          <div className="px-4 py-2 bg-background border-b-2 border-border font-bold tracking-wide">
            What changes against revision {current_revision_no}
            {diff.adders_changed && <span className="ml-2 text-xs font-normal text-amber-700 dark:text-amber-400">adders changed too</span>}
            {diff.bills_added.length > 0 && <span className="ml-2 text-xs font-normal text-muted-foreground">bills added: {diff.bills_added.join(', ')}</span>}
            {diff.bills_removed.length > 0 && <span className="ml-2 text-xs font-normal text-muted-foreground">bills removed: {diff.bills_removed.join(', ')}</span>}
          </div>
          {changes === 0 ? (
            <p className="p-4 text-sm text-muted-foreground">No item differs from the bill in force.</p>
          ) : (
            <Table className="border-collapse">
              <TableHeader>
                <TableRow className="bg-[#ffbf36] hover:bg-[#ffbf36] border-b-2 border-[#e6ac31]">
                  <TableHead className={`${HEAD} w-[90px]`}>Bill</TableHead>
                  <TableHead className={`${HEAD} w-[100px]`}>Item</TableHead>
                  <TableHead className={HEAD}>Description</TableHead>
                  <TableHead className={`${HEAD} w-[300px]`}>Current (qty × rate = amount)</TableHead>
                  <TableHead className={`${HEAD} w-[300px]`}>Proposed</TableHead>
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
                    <TableCell className={CELL}><Badge variant="outline" className="text-emerald-700 border-emerald-300">added</Badge></TableCell>
                  </TableRow>
                ))}
                {diff.items_removed.map((c, i) => (
                  <TableRow key={`r-${i}`} className="border-b border-border">
                    <TableCell className={`${CELL} tabular-nums`}>{c.bill_code}</TableCell>
                    <TableCell className={`${CELL} tabular-nums`}>{c.item_code}</TableCell>
                    <TableCell className={`${CELL} whitespace-normal`}>{c.description}</TableCell>
                    <TableCell className={`${CELL} tabular-nums whitespace-nowrap text-muted-foreground`}>{fmtTriple(c.old)}</TableCell>
                    <TableCell className={`${CELL} text-muted-foreground`}>—</TableCell>
                    <TableCell className={CELL}><Badge variant="outline" className="text-red-700 border-red-300">removed</Badge></TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </div>
      )}

      <BoqSummaryTable summary={summary} title={`Summary · revision ${rev.revision_no}`} />

      <div className="rounded-lg border-2 border-border overflow-x-auto">
        <div className="px-4 py-2 bg-background border-b-2 border-border font-bold tracking-wide">The proposed bill in full</div>
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
                  <TableCell className={CELL}>{i.unit || '—'}</TableCell>
                  <TableCell className={`${CELL} text-right tabular-nums`}>{i.contract_qty != null ? num(i.contract_qty) : '—'}</TableCell>
                  <TableCell className={`${CELL} text-right tabular-nums`}>{i.rate != null ? money(i.rate) : '—'}</TableCell>
                  <TableCell className={`${CELL} text-right tabular-nums`}>{i.contract_amount != null ? money(i.contract_amount) : '—'}</TableCell>
                </TableRow>
              )),
            ])}
          </TableBody>
        </Table>
      </div>

      <Dialog open={approveOpen} onOpenChange={setApproveOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Approve revision {rev.revision_no}?</DialogTitle>
            <DialogDescription>It becomes the bill in force at once; revision {current_revision_no ?? '—'} is kept on record as superseded.</DialogDescription>
          </DialogHeader>
          <div><Label>Note (optional)</Label><Textarea rows={2} value={note} onChange={(e) => setNote(e.target.value)} /></div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setApproveOpen(false)}>Cancel</Button>
            <Button onClick={doApprove} disabled={approve.isPending}>{approve.isPending ? 'Approving…' : 'Approve'}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={rejectOpen} onOpenChange={setRejectOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Reject revision {rev.revision_no}</DialogTitle>
            <DialogDescription>The bill in force does not change. The admin is told why so it can be fixed and proposed again.</DialogDescription>
          </DialogHeader>
          <div><Label>Reason (required)</Label><Textarea rows={3} value={note} onChange={(e) => setNote(e.target.value)} placeholder="e.g. Bill 5.3 rate for item 5.3.04 does not match the variation order" /></div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setRejectOpen(false)}>Cancel</Button>
            <Button variant="destructive" onClick={doReject} disabled={reject.isPending}>{reject.isPending ? 'Rejecting…' : 'Reject'}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
