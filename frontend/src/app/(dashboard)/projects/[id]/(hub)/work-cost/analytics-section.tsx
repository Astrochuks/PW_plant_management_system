'use client'

/**
 * Analytics — the Work & Cost workbench. One period lens (week / month /
 * quarter / year) drives everything: period KPIs with deltas, the Work
 * section (Incl. VAT, filterable by BEME bill), the Cost section
 * (filterable by category), and Work vs Cost — the back-to-back analysis
 * with independent work/cost filters.
 *
 * Convention: every work figure here is works × 1.075 (Incl. VAT, excl
 * contingency) — the earnings convention. Costs are project-wide; when a
 * bill filter is active the comparison is correlation, not attribution.
 */

import { useMemo, useState } from 'react'
import { useParams } from 'next/navigation'
import ECharts from 'echarts-for-react'
import { Card, CardContent } from '@/components/ui/card'
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import {
  categoryColor, Delta, Kpi, Legend,
} from '@/components/projects/hub-ui'
import { useProjectFinancials } from '@/hooks/use-projects'
import type { FinancialWeek } from '@/hooks/use-projects'
import { naira, pctFmt, weekLabel } from '@/lib/format'

const VAT = 1.075
export type Granularity = 'week' | 'month' | 'quarter' | 'year'

interface Bucket {
  label: string
  works: number          // ex VAT
  earnings: number       // incl VAT
  cost: number
  net: number
  weeks: number
  worksByBill: Record<string, number>   // ex VAT
  costByCat: Record<string, number>
}

function bucketKey(w: FinancialWeek, g: Granularity): string {
  const d = new Date(w.week_ending_date + 'T00:00:00')
  if (g === 'week') return weekLabel(w.year, w.week_number)
  if (g === 'month') return d.toLocaleDateString('en-GB', { month: 'short', year: 'numeric' })
  if (g === 'quarter') return `Q${Math.floor(d.getMonth() / 3) + 1} ${d.getFullYear()}`
  return String(d.getFullYear())
}

const pctChange = (now: number, prev: number | null): number | null =>
  prev == null || prev === 0 ? null : ((now - prev) / prev) * 100

function ChangeCell({ value, downIsGood }: { value: number | null; downIsGood?: boolean }) {
  if (value == null) return <span className="text-muted-foreground">—</span>
  const up = value > 0
  const good = downIsGood ? !up : up
  return (
    <span className={`font-medium tabular-nums ${good ? 'text-emerald-700 dark:text-emerald-400' : 'text-red-600'}`}>
      {up ? '▲' : '▼'} {Math.abs(value).toFixed(1)}%
    </span>
  )
}

function usePager<T>(items: T[], size = 10) {
  const [page, setPage] = useState(0)
  const pages = Math.max(1, Math.ceil(items.length / size))
  const p = Math.min(page, pages - 1)
  return {
    slice: items.slice(p * size, (p + 1) * size),
    controls: pages > 1 ? (
      <div className="flex items-center justify-end gap-2 border-t px-4 py-2 text-xs">
        <span className="text-muted-foreground">Page {p + 1} of {pages}</span>
        <Button variant="outline" size="sm" className="h-6 px-2 text-xs"
          disabled={p === 0} onClick={() => setPage(p - 1)}>Prev</Button>
        <Button variant="outline" size="sm" className="h-6 px-2 text-xs"
          disabled={p >= pages - 1} onClick={() => setPage(p + 1)}>Next</Button>
      </div>
    ) : null,
  }
}

export default function AnalyticsSection({ gran }: { gran: Granularity }) {
  const params = useParams<{ id: string }>()
  const { data: fin, isLoading } = useProjectFinancials(params.id)
  const [workBill, setWorkBill] = useState('all')
  const [costCat, setCostCat] = useState('all')
  const [vsBill, setVsBill] = useState('all')
  const [vsCat, setVsCat] = useState('all')

  const buckets: Bucket[] = useMemo(() => {
    if (!fin?.weeks) return []
    const map = new Map<string, Bucket>()
    for (const w of fin.weeks) {
      const key = bucketKey(w, gran)
      const b = map.get(key) ?? {
        label: key, works: 0, earnings: 0, cost: 0, net: 0, weeks: 0,
        worksByBill: {}, costByCat: {},
      }
      b.works += w.works_value
      b.earnings += w.earnings
      b.cost += w.cost_total
      b.net += w.net
      b.weeks += 1
      for (const [code, amt] of Object.entries(w.works_by_bill ?? {})) {
        b.worksByBill[code] = (b.worksByBill[code] ?? 0) + amt
      }
      for (const [cat, amt] of Object.entries(w.cost_by_category ?? {})) {
        b.costByCat[cat] = (b.costByCat[cat] ?? 0) + amt
      }
      map.set(key, b)
    }
    return [...map.values()]
  }, [fin, gran])

  if (isLoading) return <SectionSkeleton />
  if (!fin || fin.weeks.length === 0) {
    return (
      <div className="rounded-lg border py-12 text-center text-muted-foreground">
        <p className="text-lg font-medium text-foreground">No weekly reports yet</p>
        <p className="mt-1 text-sm">Analytics builds itself from uploaded weeks.</p>
      </div>
    )
  }

  const latest = buckets[buckets.length - 1]
  const prev = buckets.length > 1 ? buckets[buckets.length - 2] : null
  const latestMargin = latest.earnings ? latest.net / latest.earnings : null
  const prevMargin = prev && prev.earnings ? prev.net / prev.earnings : null

  const bills = fin.bills_meta.filter((b) => b.bill_code != null)
  const billName = (code: string) =>
    bills.find((b) => b.bill_code === code)?.name ?? code
  const cats = Object.keys(fin.totals.cost_by_category)

  // scope for "% of scope" — Incl. VAT, selected bill or whole BEME
  const scopeExVat = workBill === 'all'
    ? bills.reduce((a, b) => a + (b.contract_amount ?? 0), 0)
    : bills.find((b) => b.bill_code === workBill)?.contract_amount ?? 0
  const scopeInclVat = scopeExVat * VAT

  const workSeries = buckets.map((b) =>
    workBill === 'all' ? b.earnings : (b.worksByBill[workBill] ?? 0) * VAT)
  const costSeries = buckets.map((b) =>
    costCat === 'all' ? b.cost : (b.costByCat[costCat] ?? 0))
  const vsWorkSeries = buckets.map((b) =>
    vsBill === 'all' ? b.earnings : (b.worksByBill[vsBill] ?? 0) * VAT)
  const vsCostSeries = buckets.map((b) =>
    vsCat === 'all' ? b.cost : (b.costByCat[vsCat] ?? 0))

  return (
    <div className="space-y-6">
      <p className="text-xs text-muted-foreground">
        {fin.weeks.length} stored weeks · all work figures Incl. VAT (× 1.075), excl contingency
      </p>

      {/* Period KPIs, each vs the previous bucket */}
      <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
        <Kpi label={`Work + VAT · ${latest.label}`} value={naira(latest.earnings, true)}
          sub={naira(latest.earnings)}
          extra={<Delta now={latest.earnings} prev={prev?.earnings ?? null} prevLabel={prev?.label ?? ''} />} />
        <Kpi label={`Cost · ${latest.label}`} value={naira(latest.cost, true)}
          sub={naira(latest.cost)}
          extra={<Delta now={latest.cost} prev={prev?.cost ?? null} prevLabel={prev?.label ?? ''} downIsGood />} />
        <Kpi label={`Net · ${latest.label}`} value={naira(latest.net, true)}
          sub={naira(latest.net)} tone={latest.net >= 0 ? 'good' : 'bad'}
          extra={<Delta now={latest.net} prev={prev?.net ?? null} prevLabel={prev?.label ?? ''} />} />
        <Kpi label={`Margin · ${latest.label}`} value={pctFmt(latestMargin)}
          tone={latestMargin != null && latestMargin < 0 ? 'bad' : 'good'}
          extra={<Delta now={latestMargin ?? 0} prev={prevMargin} prevLabel={prev?.label ?? ''} pts />} />
      </div>

      <WorkCard
        gran={gran} buckets={buckets} series={workSeries}
        scopeInclVat={scopeInclVat}
        bill={workBill} onBill={setWorkBill} bills={bills} billName={billName}
      />

      <CostCard
        gran={gran} buckets={buckets} series={costSeries}
        cat={costCat} onCat={setCostCat} cats={cats}
      />

      <VsCard
        gran={gran} buckets={buckets}
        workSeries={vsWorkSeries} costSeries={vsCostSeries}
        bill={vsBill} onBill={setVsBill} bills={bills} billName={billName}
        cat={vsCat} onCat={setVsCat} cats={cats}
      />

      {fin.cross_check_warnings.length > 0 && (
        <div className="rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-900 dark:border-amber-700 dark:bg-amber-950 dark:text-amber-200">
          <p className="font-medium">Cross-checks vs the workbook&apos;s own Net Earnings:</p>
          <ul className="mt-1 list-disc pl-4">
            {fin.cross_check_warnings.slice(0, 6).map((w, i) => <li key={i}>{w}</li>)}
          </ul>
        </div>
      )}
    </div>
  )
}

/* ── Work section ─────────────────────────────────────────────────────── */

function WorkCard({ gran, buckets, series, scopeInclVat, bill, onBill, bills, billName }: {
  gran: Granularity
  buckets: Bucket[]
  series: number[]
  scopeInclVat: number
  bill: string
  onBill: (v: string) => void
  bills: { bill_code: string | null; name: string }[]
  billName: (c: string) => string
}) {
  const rows = useMemo(() => buckets.map((b, i) => ({
    label: b.label,
    value: series[i],
    pctOfScope: scopeInclVat ? series[i] / scopeInclVat : null,
    change: pctChange(series[i], i > 0 ? series[i - 1] : null),
  })).reverse(), [buckets, series, scopeInclVat])
  const pager = usePager(rows)

  const option = {
    tooltip: { trigger: 'axis', valueFormatter: (v: number) => naira(v, true) },
    grid: { left: 70, right: 20, top: 16, bottom: 28 },
    xAxis: { type: 'category', data: buckets.map((b) => b.label) },
    yAxis: { type: 'value', axisLabel: { formatter: (v: number) => naira(v, true) } },
    series: [{
      name: 'Work + VAT', type: 'bar', data: series.map(Math.round),
      barMaxWidth: 34, itemStyle: { color: '#f59e0b', borderRadius: [4, 4, 0, 0] },
    }],
  }

  return (
    <Card className="relative">
      <Legend>Work (Incl. VAT) · per {gran}</Legend>
      <CardContent className="space-y-4 pt-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-xs text-muted-foreground">
            {bill === 'all' ? 'all work sections' : billName(bill)} · % of scope = period work ÷ BEME scope (Incl. VAT)
          </p>
          <Select value={bill} onValueChange={onBill}>
            <SelectTrigger className="h-8 w-64 text-xs"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All work sections</SelectItem>
              {bills.map((b) => (
                <SelectItem key={b.bill_code!} value={b.bill_code!}>{b.name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <ECharts option={option} style={{ height: 240 }} notMerge />
        <div className="overflow-x-auto rounded-lg border">
          <table className="w-full min-w-[520px] text-sm">
            <thead>
              <tr className="border-b bg-muted/40 text-left text-[11px] uppercase tracking-wide text-muted-foreground">
                <th className="whitespace-nowrap px-4 py-2 font-medium capitalize">{gran}</th>
                <th className="whitespace-nowrap px-4 py-2 text-right font-medium">Work + VAT (₦)</th>
                <th className="whitespace-nowrap px-4 py-2 text-right font-medium">% of Scope</th>
                <th className="whitespace-nowrap px-4 py-2 text-right font-medium">vs Previous</th>
              </tr>
            </thead>
            <tbody>
              {pager.slice.map((r, i) => (
                <tr key={r.label} className={`border-b last:border-0 ${i % 2 ? 'bg-muted/20' : ''}`}>
                  <td className="px-4 py-1.5">{r.label}</td>
                  <td className="px-4 py-1.5 text-right tabular-nums">{naira(r.value)}</td>
                  <td className="px-4 py-1.5 text-right tabular-nums">{pctFmt(r.pctOfScope, 2)}</td>
                  <td className="px-4 py-1.5 text-right"><ChangeCell value={r.change} /></td>
                </tr>
              ))}
            </tbody>
          </table>
          {pager.controls}
        </div>
      </CardContent>
    </Card>
  )
}

/* ── Cost section ─────────────────────────────────────────────────────── */

function CostCard({ gran, buckets, series, cat, onCat, cats }: {
  gran: Granularity
  buckets: Bucket[]
  series: number[]
  cat: string
  onCat: (v: string) => void
  cats: string[]
}) {
  const rows = useMemo(() => buckets.map((b, i) => ({
    label: b.label,
    value: series[i],
    share: cat === 'all' ? null : b.cost ? series[i] / b.cost : null,
    change: pctChange(series[i], i > 0 ? series[i - 1] : null),
  })).reverse(), [buckets, series, cat])
  const pager = usePager(rows)

  const option = cat === 'all'
    ? {
        tooltip: { trigger: 'axis', valueFormatter: (v: number) => naira(v, true) },
        legend: { bottom: 0, type: 'scroll' },
        grid: { left: 70, right: 20, top: 16, bottom: 44 },
        xAxis: { type: 'category', data: buckets.map((b) => b.label) },
        yAxis: { type: 'value', axisLabel: { formatter: (v: number) => naira(v, true) } },
        series: cats.map((c, i) => ({
          name: c, type: 'bar', stack: 'cost', barMaxWidth: 34,
          itemStyle: { color: categoryColor(c, i) },
          data: buckets.map((b) => Math.round(b.costByCat[c] ?? 0)),
        })),
      }
    : {
        tooltip: { trigger: 'axis', valueFormatter: (v: number) => naira(v, true) },
        grid: { left: 70, right: 20, top: 16, bottom: 28 },
        xAxis: { type: 'category', data: buckets.map((b) => b.label) },
        yAxis: { type: 'value', axisLabel: { formatter: (v: number) => naira(v, true) } },
        series: [{
          name: cat, type: 'bar', data: series.map(Math.round), barMaxWidth: 34,
          itemStyle: { color: categoryColor(cat, 0), borderRadius: [4, 4, 0, 0] },
        }],
      }

  return (
    <Card className="relative">
      <Legend>Cost · per {gran}</Legend>
      <CardContent className="space-y-4 pt-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-xs text-muted-foreground">
            {cat === 'all' ? 'all categories, stacked' : `${cat} only`} · Cost Report categories
          </p>
          <Select value={cat} onValueChange={onCat}>
            <SelectTrigger className="h-8 w-56 text-xs"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All categories</SelectItem>
              {cats.map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
        <ECharts option={option} style={{ height: 240 }} notMerge />
        <div className="overflow-x-auto rounded-lg border">
          <table className="w-full min-w-[520px] text-sm">
            <thead>
              <tr className="border-b bg-muted/40 text-left text-[11px] uppercase tracking-wide text-muted-foreground">
                <th className="whitespace-nowrap px-4 py-2 font-medium capitalize">{gran}</th>
                <th className="whitespace-nowrap px-4 py-2 text-right font-medium">Cost (₦)</th>
                {cat !== 'all' && (
                  <th className="whitespace-nowrap px-4 py-2 text-right font-medium">Share of Period Cost</th>
                )}
                <th className="whitespace-nowrap px-4 py-2 text-right font-medium">vs Previous</th>
              </tr>
            </thead>
            <tbody>
              {pager.slice.map((r, i) => (
                <tr key={r.label} className={`border-b last:border-0 ${i % 2 ? 'bg-muted/20' : ''}`}>
                  <td className="px-4 py-1.5">{r.label}</td>
                  <td className="px-4 py-1.5 text-right tabular-nums">{naira(r.value)}</td>
                  {cat !== 'all' && (
                    <td className="px-4 py-1.5 text-right tabular-nums">{pctFmt(r.share)}</td>
                  )}
                  <td className="px-4 py-1.5 text-right"><ChangeCell value={r.change} downIsGood /></td>
                </tr>
              ))}
            </tbody>
          </table>
          {pager.controls}
        </div>
      </CardContent>
    </Card>
  )
}

/* ── Work vs Cost — the real analysis ────────────────────────────────── */

function VsCard({ gran, buckets, workSeries, costSeries, bill, onBill, bills, billName, cat, onCat, cats }: {
  gran: Granularity
  buckets: Bucket[]
  workSeries: number[]
  costSeries: number[]
  bill: string
  onBill: (v: string) => void
  bills: { bill_code: string | null; name: string }[]
  billName: (c: string) => string
  cat: string
  onCat: (v: string) => void
  cats: string[]
}) {
  const filtered = bill !== 'all' || cat !== 'all'
  const rows = useMemo(() => buckets.map((b, i) => {
    const w = workSeries[i]
    const c = costSeries[i]
    return {
      label: b.label,
      work: w, cost: c, net: w - c,
      margin: w ? (w - c) / w : null,
      dWork: pctChange(w, i > 0 ? workSeries[i - 1] : null),
      dCost: pctChange(c, i > 0 ? costSeries[i - 1] : null),
    }
  }).reverse(), [buckets, workSeries, costSeries])
  const pager = usePager(rows)

  const workLabel = bill === 'all' ? 'Work + VAT' : `${billName(bill)} (Incl. VAT)`
  const costLabel = cat === 'all' ? 'Total cost' : cat

  const option = {
    tooltip: { trigger: 'axis', valueFormatter: (v: number) => naira(v, true) },
    legend: { bottom: 0 },
    grid: { left: 70, right: 20, top: 16, bottom: 44 },
    xAxis: { type: 'category', data: buckets.map((b) => b.label) },
    yAxis: { type: 'value', axisLabel: { formatter: (v: number) => naira(v, true) } },
    series: [
      {
        name: workLabel, type: 'bar', barMaxWidth: 26,
        data: workSeries.map(Math.round),
        itemStyle: { color: '#059669', borderRadius: [4, 4, 0, 0] },
      },
      {
        name: costLabel, type: 'bar', barMaxWidth: 26,
        data: costSeries.map(Math.round),
        itemStyle: { color: '#dc2626', borderRadius: [4, 4, 0, 0] },
      },
    ],
  }

  return (
    <Card className="relative">
      <Legend>Work vs Cost · per {gran}</Legend>
      <CardContent className="space-y-4 pt-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="max-w-xl text-xs text-muted-foreground">
            {filtered
              ? 'Filtered view — costs are recorded project-wide, not per work section, so this is a correlation, not an allocation.'
              : 'Work done (Incl. VAT) against cost, period by period — gain, margin and movement.'}
          </p>
          <div className="flex flex-wrap items-center gap-2">
            <Select value={bill} onValueChange={onBill}>
              <SelectTrigger className="h-8 w-56 text-xs"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All work sections</SelectItem>
                {bills.map((b) => (
                  <SelectItem key={b.bill_code!} value={b.bill_code!}>{b.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <span className="text-xs text-muted-foreground">vs</span>
            <Select value={cat} onValueChange={onCat}>
              <SelectTrigger className="h-8 w-48 text-xs"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Total cost</SelectItem>
                {cats.map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
        </div>
        <ECharts option={option} style={{ height: 260 }} notMerge />
        <div className="overflow-x-auto rounded-lg border">
          <table className="w-full min-w-[720px] text-sm">
            <thead>
              <tr className="border-b bg-muted/40 text-left text-[11px] uppercase tracking-wide text-muted-foreground">
                <th className="whitespace-nowrap px-4 py-2 font-medium capitalize">{gran}</th>
                <th className="whitespace-nowrap px-4 py-2 text-right font-medium">{workLabel} (₦)</th>
                <th className="whitespace-nowrap px-4 py-2 text-right font-medium">{costLabel} (₦)</th>
                <th className="whitespace-nowrap px-4 py-2 text-right font-medium">Net (₦)</th>
                <th className="whitespace-nowrap px-4 py-2 text-right font-medium">Margin</th>
                <th className="whitespace-nowrap px-4 py-2 text-right font-medium">Work Δ</th>
                <th className="whitespace-nowrap px-4 py-2 text-right font-medium">Cost Δ</th>
              </tr>
            </thead>
            <tbody>
              {pager.slice.map((r, i) => (
                <tr key={r.label} className={`border-b last:border-0 ${i % 2 ? 'bg-muted/20' : ''}`}>
                  <td className="px-4 py-1.5">{r.label}</td>
                  <td className="px-4 py-1.5 text-right tabular-nums">{naira(r.work)}</td>
                  <td className="px-4 py-1.5 text-right tabular-nums">{naira(r.cost)}</td>
                  <td className={`px-4 py-1.5 text-right font-medium tabular-nums ${r.net >= 0 ? 'text-emerald-700 dark:text-emerald-400' : 'text-red-600'}`}>
                    {naira(r.net)}
                  </td>
                  <td className="px-4 py-1.5 text-right tabular-nums">{pctFmt(r.margin)}</td>
                  <td className="px-4 py-1.5 text-right"><ChangeCell value={r.dWork} /></td>
                  <td className="px-4 py-1.5 text-right"><ChangeCell value={r.dCost} downIsGood /></td>
                </tr>
              ))}
            </tbody>
          </table>
          {pager.controls}
        </div>
      </CardContent>
    </Card>
  )
}

function SectionSkeleton() {
  return (
    <div className="space-y-4">
      <Skeleton className="h-9 w-72" />
      <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
        {[...Array(4)].map((_, i) => <Skeleton key={i} className="h-24" />)}
      </div>
      <Skeleton className="h-96" />
      <Skeleton className="h-96" />
    </div>
  )
}
