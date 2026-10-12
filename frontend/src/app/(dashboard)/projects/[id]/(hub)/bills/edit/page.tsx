'use client'

/**
 * Bill builder — the third door: enter or correct a bill by hand. Admin
 * only. Prefilled from the current revision when there is one (fix an
 * item, add a missing one) or empty for a project with no bill yet.
 * Amount = quantity × rate, always (decision 2026-10-12). Saving records
 * the next revision through the same endpoint the imports use; the
 * current adders carry forward.
 */

import { useMemo, useState } from 'react'
import Link from 'next/link'
import { useParams, useRouter } from 'next/navigation'
import { ArrowLeft, Plus, Trash2 } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Card, CardContent, CardHeader } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { MiniKpi, MiniKpiRow } from '@/components/shared/mini-kpi'
import { useAuth } from '@/providers/auth-provider'
import { useProjectBills, useRecordBillsRevision } from '@/hooks/use-projects'
import type { BoqAdder, BoqBill, ProjectBills } from '@/lib/api/projects'
import { getErrorMessage } from '@/lib/api/client'
import { money } from '@/lib/format'

type ItemRow = { key: string; item_code: string; description: string; unit: string; qty: string; rate: string }
type BillRow = { key: string; bill_code: string; name: string; items: ItemRow[] }

let seq = 0
const nextKey = () => `k${++seq}`

/** quantity × rate at 2 dp, or null while either is blank */
const amountOf = (qty: string, rate: string): number | null => {
  if (qty.trim() === '' || rate.trim() === '') return null
  const q = Number(qty), r = Number(rate)
  if (Number.isNaN(q) || Number.isNaN(r)) return null
  return Math.round(q * r * 100) / 100
}
const billTotal = (b: BillRow) => b.items.reduce((a, i) => a + (amountOf(i.qty, i.rate) ?? 0), 0)

const seedFrom = (bills: BoqBill[]): BillRow[] =>
  bills.map((b) => ({
    key: nextKey(), bill_code: b.bill_code, name: b.name ?? '',
    items: b.items.map((i) => ({
      key: nextKey(), item_code: i.item_code ?? '', description: i.description, unit: i.unit ?? '',
      qty: i.contract_qty == null ? '' : String(i.contract_qty), rate: i.rate == null ? '' : String(i.rate),
    })),
  }))

export default function BillBuilderPage() {
  const { id } = useParams<{ id: string }>()
  const { user } = useAuth()
  const { data, isLoading } = useProjectBills(id)
  if (user && user.role !== 'admin') {
    return <p className="text-sm text-muted-foreground">Only an admin can enter or change the bill.</p>
  }
  if (isLoading || !data) return <Skeleton className="h-64" />
  return <BuilderForm projectId={id} initial={data} />
}

function BuilderForm({ projectId, initial }: { projectId: string; initial: ProjectBills }) {
  const router = useRouter()
  const record = useRecordBillsRevision(projectId)
  const hasRevision = !!initial.revision
  const nextRevisionNo = (initial.revisions[0]?.revision_no ?? 0) + 1
  const adders: BoqAdder[] = initial.revision?.adders ?? []
  const [bills, setBills] = useState<BillRow[]>(() => (hasRevision ? seedFrom(initial.bills) : []))
  const [effectiveDate, setEffectiveDate] = useState(() => new Date().toISOString().slice(0, 10))
  const [note, setNote] = useState('')

  const itemCount = bills.reduce((a, b) => a + b.items.length, 0)
  const worksTotal = useMemo(() => bills.reduce((a, b) => a + billTotal(b), 0), [bills])

  const updateBill = (bk: string, patch: Partial<BillRow>) =>
    setBills((bs) => bs.map((b) => (b.key === bk ? { ...b, ...patch } : b)))
  const updateItem = (bk: string, ik: string, patch: Partial<ItemRow>) =>
    setBills((bs) => bs.map((b) => (b.key === bk ? { ...b, items: b.items.map((i) => (i.key === ik ? { ...i, ...patch } : i)) } : b)))
  const addBill = () => setBills((bs) => [...bs, { key: nextKey(), bill_code: '', name: '', items: [] }])
  const addItem = (bk: string) =>
    setBills((bs) => bs.map((b) => (b.key === bk ? { ...b, items: [...b.items, { key: nextKey(), item_code: '', description: '', unit: '', qty: '', rate: '' }] } : b)))
  const removeBill = (bk: string) => setBills((bs) => bs.filter((b) => b.key !== bk))
  const removeItem = (bk: string, ik: string) =>
    setBills((bs) => bs.map((b) => (b.key === bk ? { ...b, items: b.items.filter((i) => i.key !== ik) } : b)))

  const save = async () => {
    if (!bills.length) return toast.error('Add at least one bill')
    for (const [bi, b] of bills.entries()) {
      if (!b.bill_code.trim()) return toast.error(`Bill ${bi + 1}: give it a code (e.g. 5 or 5.1)`)
      for (const [ii, i] of b.items.entries()) {
        if (!i.description.trim()) return toast.error(`Bill ${b.bill_code}, item ${ii + 1}: description is required`)
        if (i.qty.trim() !== '' && Number.isNaN(Number(i.qty))) return toast.error(`Bill ${b.bill_code}, item ${ii + 1}: quantity must be a number`)
        if (i.rate.trim() !== '' && (Number.isNaN(Number(i.rate)) || Number(i.rate) < 0)) return toast.error(`Bill ${b.bill_code}, item ${ii + 1}: rate must be a number`)
      }
    }
    if (!itemCount) return toast.error('Add at least one item')
    if (!effectiveDate) return toast.error('Enter the date the bill takes effect')
    const seenCodes = new Set<string>()
    for (const b of bills) {
      const c = b.bill_code.trim()
      if (seenCodes.has(c)) return toast.error(`Bill code ${c} appears twice`)
      seenCodes.add(c)
    }
    const payload: BoqBill[] = bills.map((b, bi) => {
      const items = b.items.map((i, ii) => ({
        item_code: i.item_code.trim(), description: i.description.trim(), unit: i.unit.trim() || null,
        contract_qty: i.qty.trim() === '' ? null : Number(i.qty), rate: i.rate.trim() === '' ? null : Number(i.rate),
        contract_amount: amountOf(i.qty, i.rate), sort_order: ii + 1,
      }))
      const code = b.bill_code.trim()
      return {
        bill_code: code, bill_no: /^\d+$/.test(code) ? Number(code) : null, sort_order: bi + 1,
        name: b.name.trim() || null, sheet_total: null,
        items_total: Math.round(billTotal(b) * 100) / 100, item_count: items.length, items,
      }
    })
    try {
      const res = await record.mutateAsync({
        source: hasRevision ? 'correction' : 'award_beme', effective_date: effectiveDate,
        note: note.trim() || undefined, bills: payload, adders,
      })
      toast.success(res.state === 'pending'
        ? `Revision ${res.revision_no} sent to the project manager for approval`
        : `Revision ${res.revision_no} recorded · works total ${money(res.works_total)}`)
      router.push(`/projects/${projectId}/bills`)
    } catch (err) {
      toast.error(getErrorMessage(err))
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold">{hasRevision ? 'Edit the bill by hand' : 'Enter the bill by hand'}</h2>
          <p className="text-sm text-muted-foreground">
            Amount is quantity × rate. Saving records <strong>revision {nextRevisionNo}</strong>
            {initial.revision?.locked_at ? ' and sends it to the project manager for approval; the bill in force does not change until then.' : hasRevision ? '; the current bill stays on record.' : '.'}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" asChild>
            <Link href={`/projects/${projectId}/bills`}><ArrowLeft className="h-3.5 w-3.5 mr-1.5" />Back to the bill</Link>
          </Button>
          {hasRevision && bills.length > 0 && (
            <Button variant="ghost" size="sm" onClick={() => setBills([])}>Clear all and start empty</Button>
          )}
        </div>
      </div>

      <MiniKpiRow>
        <MiniKpi label="Bills" value={bills.length.toLocaleString()} />
        <MiniKpi label="Items" value={itemCount.toLocaleString()} />
        <MiniKpi label="Works total" value={money(worksTotal)} />
      </MiniKpiRow>

      {bills.map((b, bi) => (
        <Card key={b.key}>
          <CardHeader className="pb-3">
            <div className="flex flex-wrap items-end gap-3">
              <div className="w-28">
                <Label className="text-xs">Bill code</Label>
                <Input value={b.bill_code} onChange={(e) => updateBill(b.key, { bill_code: e.target.value })} placeholder={`${bi + 1}`} />
              </div>
              <div className="min-w-[220px] flex-1">
                <Label className="text-xs">Bill name</Label>
                <Input value={b.name} onChange={(e) => updateBill(b.key, { name: e.target.value })} placeholder="e.g. GENERAL" />
              </div>
              <div className="text-right">
                <p className="text-[11px] uppercase tracking-wide text-muted-foreground">Bill total</p>
                <p className="font-semibold tabular-nums">{money(billTotal(b))}</p>
              </div>
              <Button variant="ghost" size="icon" className="text-destructive" onClick={() => removeBill(b.key)} title="Remove this bill">
                <Trash2 className="h-4 w-4" />
              </Button>
            </div>
          </CardHeader>
          <CardContent className="space-y-2">
            <div className="overflow-x-auto">
              <div className="min-w-[860px]">
                <div className="grid grid-cols-[110px_minmax(0,1fr)_80px_130px_150px_170px_40px] gap-2 px-1 text-[11px] uppercase tracking-wide text-muted-foreground">
                  <span>Item</span><span>Description</span><span>Unit</span><span className="text-right">Quantity</span><span className="text-right">Rate</span><span className="text-right">Amount</span><span />
                </div>
                {b.items.map((i) => (
                  <div key={i.key} className="grid grid-cols-[110px_minmax(0,1fr)_80px_130px_150px_170px_40px] items-center gap-2 py-1">
                    <Input value={i.item_code} onChange={(e) => updateItem(b.key, i.key, { item_code: e.target.value })} placeholder="5.01" className="h-9" />
                    <Input value={i.description} onChange={(e) => updateItem(b.key, i.key, { description: e.target.value })} placeholder="Description" className="h-9" />
                    <Input value={i.unit} onChange={(e) => updateItem(b.key, i.key, { unit: e.target.value })} placeholder="m3" className="h-9" />
                    <Input type="number" step="0.001" value={i.qty} onChange={(e) => updateItem(b.key, i.key, { qty: e.target.value })} className="h-9 text-right" />
                    <Input type="number" step="0.01" min="0" value={i.rate} onChange={(e) => updateItem(b.key, i.key, { rate: e.target.value })} className="h-9 text-right" />
                    <div className="text-right text-sm tabular-nums">{amountOf(i.qty, i.rate) == null ? <span className="text-muted-foreground">—</span> : money(amountOf(i.qty, i.rate) as number)}</div>
                    <Button variant="ghost" size="icon" className="h-8 w-8 text-destructive" onClick={() => removeItem(b.key, i.key)} title="Remove item">
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                ))}
              </div>
            </div>
            <Button variant="outline" size="sm" onClick={() => addItem(b.key)}>
              <Plus className="h-3.5 w-3.5 mr-1.5" />Add item
            </Button>
          </CardContent>
        </Card>
      ))}

      <Button variant="outline" onClick={addBill}>
        <Plus className="h-4 w-4 mr-2" />Add bill
      </Button>

      <Card>
        <CardContent className="grid gap-4 pt-6 sm:grid-cols-[200px_minmax(0,1fr)_auto] sm:items-end">
          <div>
            <Label>Effective date</Label>
            <Input type="date" value={effectiveDate} onChange={(e) => setEffectiveDate(e.target.value)} />
          </div>
          <div>
            <Label>Note</Label>
            <Textarea rows={1} value={note} onChange={(e) => setNote(e.target.value)} placeholder={hasRevision ? 'what changed and why' : 'e.g. entered from the award BEME, letter ref …'} />
          </div>
          <Button onClick={save} disabled={record.isPending}>
            {record.isPending ? 'Saving…' : `Save as revision ${nextRevisionNo}`}
          </Button>
        </CardContent>
      </Card>
    </div>
  )
}
