'use client'

/**
 * Work done — the BEME drill-down. Per-item cumulative = stored weeks +
 * baseline/gap adjustments (kobo-exact vs the workbook's to-date).
 * Quantity and amount progress are independent facts; % uses AMOUNTS.
 */

import { useMemo, useState } from 'react'
import { useParams } from 'next/navigation'
import { ChevronDown, ChevronRight } from 'lucide-react'
import { Card, CardContent, CardHeader } from '@/components/ui/card'
import { Legend } from '@/components/projects/hub-ui'
import { Skeleton } from '@/components/ui/skeleton'
import { Badge } from '@/components/ui/badge'
import { useProjectWorkDone } from '@/hooks/use-projects'
import type { WorkDoneBill } from '@/lib/api/projects'
import { naira, pctFmt, num } from '@/lib/format'

export default function WorkDonePage() {
  const params = useParams<{ id: string }>()
  const { data, isLoading } = useProjectWorkDone(params.id)
  const [open, setOpen] = useState<Record<string, boolean>>({})

  const totals = useMemo(() => {
    if (!data?.bills) return null
    const contract = data.bills.reduce((a, b) => a + b.contract_amount, 0)
    const done = data.bills.reduce((a, b) => a + b.amount_done, 0)
    const overruns = data.bills.flatMap((b) => b.items).filter((i) => i.is_overrun).length
    return { contract, done, pct: contract ? done / contract : null, overruns }
  }, [data])

  if (isLoading) return <PageSkeleton />
  if (!data || data.bills.length === 0) {
    return (
      <div className="rounded-lg border py-12 text-center text-muted-foreground">
        <p className="text-lg font-medium text-foreground">No BEME data yet</p>
        <p className="mt-1 text-sm">Upload a weekly report to build the bill structure.</p>
      </div>
    )
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs font-bold uppercase tracking-wide">Work done — bills &amp; items</p>
        {(totals?.overruns ?? 0) > 0 && (
          <span className="rounded-full bg-amber-500/15 px-2 py-0.5 text-[11px] font-semibold text-amber-800 dark:text-amber-300">
            {totals!.overruns} quantity over-run{totals!.overruns > 1 ? 's' : ''} flagged — qty done &gt; contract qty, never capped
          </span>
        )}
      </div>

      {data.bills.map((bill) => (
        <BillCard
          key={bill.bill_code ?? bill.bill_name}
          bill={bill}
          open={!!open[bill.bill_code ?? '']}
          onToggle={() => setOpen((o) => ({ ...o, [bill.bill_code ?? '']: !o[bill.bill_code ?? ''] }))}
        />
      ))}
    </div>
  )
}

function BillCard({ bill, open, onToggle }: { bill: WorkDoneBill; open: boolean; onToggle: () => void }) {
  const pct = bill.pct_complete
  return (
    <Card className="overflow-hidden py-0">
      <button
        type="button"
        onClick={onToggle}
        className="flex w-full flex-wrap items-center gap-x-4 gap-y-1 px-4 py-3 text-left hover:bg-muted/40"
      >
        {open ? <ChevronDown className="h-4 w-4 shrink-0" /> : <ChevronRight className="h-4 w-4 shrink-0" />}
        <span className="font-semibold">
          Bill {bill.bill_code} — {bill.bill_name}
        </span>
        <span className="text-xs text-muted-foreground">{bill.items.length} items</span>
        <span className="ml-auto flex items-center gap-4 text-sm tabular-nums">
          <span className="text-muted-foreground hidden md:inline">{naira(bill.amount_done, true)} / {naira(bill.contract_amount, true)}</span>
          <span className="w-14 text-right font-medium">{pctFmt(pct)}</span>
        </span>
        <span className="basis-full">
          <span className="block h-1.5 w-full overflow-hidden rounded-full bg-muted">
            <span
              className={`block h-full rounded-full ${pct != null && pct > 1 ? 'bg-red-500' : 'bg-primary'}`}
              style={{ width: `${Math.min(100, (pct ?? 0) * 100)}%` }}
            />
          </span>
        </span>
      </button>
      {open && (
        <div className="overflow-x-auto border-t">
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b bg-muted/40 text-left text-muted-foreground">
                <th className="px-3 py-2 font-medium">Item</th>
                <th className="px-3 py-2 font-medium min-w-[220px]">Description</th>
                <th className="px-3 py-2 font-medium">Unit</th>
                <th className="px-3 py-2 text-right font-medium">Contract Qty</th>
                <th className="px-3 py-2 text-right font-medium">Qty Done</th>
                <th className="px-3 py-2 text-right font-medium">Rate ₦</th>
                <th className="px-3 py-2 text-right font-medium">Contract Amount</th>
                <th className="px-3 py-2 text-right font-medium">Amount Done</th>
                <th className="px-3 py-2 text-right font-medium">This Week</th>
                <th className="px-3 py-2 text-right font-medium">% Complete</th>
              </tr>
            </thead>
            <tbody>
              {bill.items.map((it, idx) => (
                <tr key={`${it.item_code}-${idx}`} className={`border-b last:border-0 ${idx % 2 ? 'bg-muted/20' : ''}`}>
                  <td className="px-3 py-1.5 tabular-nums">{it.item_code}</td>
                  <td className="max-w-[340px] truncate px-3 py-1.5" title={it.description ?? ''}>{it.description}</td>
                  <td className="px-3 py-1.5">{it.unit}</td>
                  <td className="px-3 py-1.5 text-right tabular-nums">{it.no_contract_qty ? '—' : num(it.contract_qty, 2)}</td>
                  <td className="px-3 py-1.5 text-right tabular-nums">
                    {num(it.qty_done, 2)}
                    {it.is_overrun && <Badge variant="outline" className="ml-1 border-red-300 px-1 text-[9px] text-red-600">over</Badge>}
                  </td>
                  <td className="px-3 py-1.5 text-right tabular-nums">{num(it.rate, 2)}</td>
                  <td className="px-3 py-1.5 text-right tabular-nums">{naira(it.contract_amount)}</td>
                  <td className="px-3 py-1.5 text-right tabular-nums">{naira(it.amount_done)}</td>
                  <td className="px-3 py-1.5 text-right tabular-nums">
                    {it.latest_amount ? naira(it.latest_amount) : <span className="text-muted-foreground">—</span>}
                  </td>
                  <td className={`px-3 py-1.5 text-right tabular-nums ${
                    it.pct_complete != null && it.pct_complete > 1 ? 'font-medium text-red-600' : ''
                  }`}>
                    {pctFmt(it.pct_complete)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  )
}


function PageSkeleton() {
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
        {[...Array(4)].map((_, i) => <Skeleton key={i} className="h-24" />)}
      </div>
      {[...Array(5)].map((_, i) => <Skeleton key={i} className="h-16" />)}
    </div>
  )
}
