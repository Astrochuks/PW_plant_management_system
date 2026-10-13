'use client'

/**
 * The bill's summary — the table the BEME sheet ends with: one row per
 * bill, the works total, then the adders (contingency, VOP, VAT …) down to
 * the contract figure. Figures come from the server (bills_summary.py);
 * nothing is recomputed here.
 */

import Image from 'next/image'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import type { BoqAdder, BoqSummary } from '@/lib/api/projects'
import { money } from '@/lib/format'

const HEAD = 'text-[#101415] font-semibold text-xs uppercase tracking-wider border-x border-[#e6ac31]/50 whitespace-nowrap'
const CELL = 'text-sm border-x border-border/50 py-2'

export const adderLabel = (a: Pick<BoqAdder, 'name' | 'kind' | 'value'>): string => {
  if (a.kind === 'amount') return a.name
  const pct = `${Number(a.value)}%`
  return a.kind === 'percent_of_works' ? `${a.name} · ${pct} of works total` : `${a.name} · ${pct} of subtotal`
}

export function BoqSummaryTable({ summary, title }: { summary: BoqSummary; title: string }) {
  return (
    <div className="rounded-lg border-2 border-border overflow-x-auto">
      <div className="flex items-center gap-3 px-4 py-2 bg-background border-b-2 border-border">
        <Image src="/images/logo.png" alt="P.W. Nigeria Ltd." width={55} height={55} className="rounded shrink-0" />
        <span className="text-foreground font-bold text-base tracking-wide">{title}</span>
      </div>
      <Table className="border-collapse">
        <TableHeader>
          <TableRow className="bg-[#ffbf36] hover:bg-[#ffbf36] border-b-2 border-[#e6ac31]">
            <TableHead className={`${HEAD} w-[110px]`}>Bill</TableHead>
            <TableHead className={HEAD}>Description</TableHead>
            <TableHead className={`${HEAD} w-[220px] text-right`}>Amount</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {summary.bills.map((b, idx) => (
            <TableRow key={b.bill_code} className={`${idx % 2 === 0 ? 'bg-background' : 'bg-muted/30'} hover:bg-muted/60 border-b border-border`}>
              <TableCell className={`${CELL} tabular-nums whitespace-nowrap`}>{b.bill_code}</TableCell>
              <TableCell className={`${CELL} whitespace-normal`}>{b.name || <span className="text-muted-foreground">—</span>}</TableCell>
              <TableCell className={`${CELL} text-right tabular-nums whitespace-nowrap`}>{money(b.amount)}</TableCell>
            </TableRow>
          ))}
          <TableRow className="bg-[#fff3d6] hover:bg-[#fff3d6] dark:bg-[#3a2f14] dark:hover:bg-[#3a2f14] border-b border-border">
            <TableCell colSpan={2} className={`${CELL} font-semibold`}>Works total</TableCell>
            <TableCell className={`${CELL} text-right font-semibold tabular-nums whitespace-nowrap`}>{money(summary.works_total)}</TableCell>
          </TableRow>
          {summary.lines.map((l, idx) => (
            <TableRow key={`${l.name}-${idx}`} className="bg-background hover:bg-muted/60 border-b border-border">
              <TableCell className={CELL} />
              <TableCell className={`${CELL} whitespace-normal`}>{adderLabel(l)}</TableCell>
              <TableCell className={`${CELL} text-right tabular-nums whitespace-nowrap`}>{money(l.amount)}</TableCell>
            </TableRow>
          ))}
          <TableRow className="bg-background hover:bg-background border-t-2 border-border">
            <TableCell colSpan={2} className={`${CELL} font-bold uppercase tracking-wide`}>
              {summary.lines.length ? 'Contract sum' : 'Works total'}
            </TableCell>
            <TableCell className={`${CELL} text-right font-bold tabular-nums whitespace-nowrap`}>{money(summary.contract_total)}</TableCell>
          </TableRow>
        </TableBody>
      </Table>
    </div>
  )
}
