'use client'

/**
 * Bill builder — the third door: enter or correct a bill by hand. Admin
 * only. Prefilled from the current revision when there is one (fix an
 * item, add a missing one) or empty for a project with no bill yet.
 * Amount = quantity × rate, always (decision 2026-10-12). Saving records
 * the next revision through the same endpoint the imports use; the
 * current adders carry forward.
 */

import { useCallback, useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { useParams, useRouter } from 'next/navigation'
import { ArrowLeft, Plus, RotateCcw, Trash2 } from 'lucide-react'
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
import { money, unitKey, unitLabel } from '@/lib/format'
import { AddersFields, LadderPreview, ORDER_NOTE, addersFromRows, rowsFromAdders, type AdderRow } from '@/components/projects/bills/adders-dialog'

type ItemRow = { key: string; item_code: string; description: string; unit: string; qty: string; rate: string }
type BillRow = { key: string; bill_code: string; name: string; items: ItemRow[] }

let seq = 0
const nextKey = () => `k${++seq}`

// ── Draft persistence — the same safety net the purchase-order entry has:
// everything typed is kept in this browser, per project, until the bill is
// saved or the draft is discarded (2026-10-13: a mis-click on Back lost a
// whole bill mid-entry). ────────────────────────────────────────────────
const draftKey = (projectId: string) => `boq_builder_draft_v1:${projectId}`
interface DraftShape { bills: BillRow[]; adders?: AdderRow[]; effectiveDate: string; note: string; savedAt: string }
const draftIsEmpty = (bills: BillRow[], note: string) =>
  !note.trim() && !bills.some((b) => b.bill_code.trim() || b.name.trim() || b.items.some((i) => i.item_code.trim() || i.description.trim() || i.qty.trim() || i.rate.trim()))
function loadDraft(projectId: string): DraftShape | null {
  try {
    const raw = localStorage.getItem(draftKey(projectId))
    if (!raw) return null
    const d = JSON.parse(raw) as DraftShape
    if (!Array.isArray(d.bills) || draftIsEmpty(d.bills, d.note ?? '')) return null
    // fresh keys so the counter never collides with restored rows
    return { ...d, bills: d.bills.map((b) => ({ ...b, key: nextKey(), items: b.items.map((i) => ({ ...i, key: nextKey() })) })) }
  } catch { return null }
}
function saveDraft(projectId: string, d: DraftShape) { try { localStorage.setItem(draftKey(projectId), JSON.stringify(d)) } catch { /* storage unavailable: nothing to keep */ } }
function clearDraft(projectId: string) { try { localStorage.removeItem(draftKey(projectId)) } catch { /* ignore */ } }

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
  const adders = useMemo<BoqAdder[]>(() => initial.revision?.adders ?? [], [initial.revision])
  // a draft in this browser wins over the saved bill — it is what you were typing
  const [draft] = useState<DraftShape | null>(() => (typeof window === 'undefined' ? null : loadDraft(projectId)))
  const [bills, setBills] = useState<BillRow[]>(() => draft?.bills ?? (hasRevision ? seedFrom(initial.bills) : []))
  const [effectiveDate, setEffectiveDate] = useState(() => draft?.effectiveDate || new Date().toISOString().slice(0, 10))
  const [note, setNote] = useState(draft?.note ?? '')
  // the adders belong with the bill — entered here on a first bill, or carried from the current revision
  const [adderRows, setAdderRows] = useState<AdderRow[]>(() => draft?.adders ?? rowsFromAdders(adders))
  const [draftRestored, setDraftRestored] = useState(!!draft)

  // keep the draft current on every change; an empty form clears it
  useEffect(() => {
    if (draftIsEmpty(bills, note) && adderRows.length === 0) clearDraft(projectId)
    else saveDraft(projectId, { bills, adders: adderRows, effectiveDate, note, savedAt: new Date().toISOString() })
  }, [projectId, bills, adderRows, effectiveDate, note])

  // leaving with unsaved typing asks first (the draft survives either way)
  useEffect(() => {
    const warn = (e: BeforeUnloadEvent) => { if (!draftIsEmpty(bills, note)) { e.preventDefault() } }
    window.addEventListener('beforeunload', warn)
    return () => window.removeEventListener('beforeunload', warn)
  }, [bills, note])

  const discardDraft = useCallback(() => {
    clearDraft(projectId)
    setBills(hasRevision ? seedFrom(initial.bills) : [])
    setAdderRows(rowsFromAdders(adders))
    setNote('')
    setEffectiveDate(new Date().toISOString().slice(0, 10))
    setDraftRestored(false)
  }, [projectId, hasRevision, initial.bills, adders])

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
    const parsedAdders = addersFromRows(adderRows)
    if ('error' in parsedAdders) return toast.error(parsedAdders.error)
    const seenCodes = new Set<string>()
    for (const b of bills) {
      const c = b.bill_code.trim()
      if (seenCodes.has(c)) return toast.error(`Bill code ${c} appears twice`)
      seenCodes.add(c)
    }
    const payload: BoqBill[] = bills.map((b, bi) => {
      const items = b.items.map((i, ii) => ({
        item_code: i.item_code.trim(), description: i.description.trim(), unit: unitKey(i.unit) || null,
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
        note: note.trim() || undefined, bills: payload, adders: parsedAdders.adders,
      })
      clearDraft(projectId)  // saved — nothing to restore next visit
      toast.success(`Revision ${res.revision_no} recorded · works total ${money(res.works_total)}`)
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
            {hasRevision ? '; the current version stays in the history.' : '.'}
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

      {draftRestored && (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-amber-300 bg-amber-50 px-4 py-3 text-sm dark:border-amber-700 dark:bg-amber-950">
          <div>
            <span className="font-medium">Draft restored.</span>
            <span className="ml-2 text-muted-foreground">
              What you typed before{draft?.savedAt ? ` (last kept ${new Date(draft.savedAt).toLocaleString('en-NG', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })})` : ''} is back. It stays in this browser until you save or discard it.
            </span>
          </div>
          <div className="flex items-center gap-2">
            <Button variant="ghost" size="sm" onClick={() => setDraftRestored(false)}>OK</Button>
            <Button variant="outline" size="sm" onClick={discardDraft}><RotateCcw className="h-3.5 w-3.5 mr-1.5" />Discard draft</Button>
          </div>
        </div>
      )}

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
                  <span>Item</span><span>Description</span><span title="type m2 / m3 — prints as m² / m³">Unit</span><span className="text-right">Quantity</span><span className="text-right">Rate</span><span className="text-right">Amount</span><span />
                </div>
                {b.items.map((i) => (
                  <div key={i.key} className="grid grid-cols-[110px_minmax(0,1fr)_80px_130px_150px_170px_40px] items-center gap-2 py-1">
                    <Input value={i.item_code} onChange={(e) => updateItem(b.key, i.key, { item_code: e.target.value })} placeholder="5.01" className="h-9" />
                    <Input value={i.description} onChange={(e) => updateItem(b.key, i.key, { description: e.target.value })} placeholder="Description" className="h-9" />
                    <Input value={i.unit} onChange={(e) => updateItem(b.key, i.key, { unit: e.target.value })} placeholder="m3" className="h-9"
                      title={i.unit ? `shows as ${unitLabel(unitKey(i.unit))}` : 'type m2 / m3 — it prints as m² / m³'} />
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

      {/* Adders — the ladder under the works total, saved with the bill */}
      <Card>
        <CardHeader className="pb-3">
          <h3 className="text-base font-semibold">Adders under the works total</h3>
          <p className="text-sm text-muted-foreground">{ORDER_NOTE}</p>
        </CardHeader>
        <CardContent className="grid gap-4 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
          <AddersFields rows={adderRows} onChange={setAdderRows} />
          <LadderPreview works={worksTotal} rows={adderRows} />
        </CardContent>
      </Card>

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
