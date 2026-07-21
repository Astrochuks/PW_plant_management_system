'use client'

/**
 * Overview — the PROJECT KPI DASHBOARD. Mirrors the company's Excel
 * dashboard block-for-block; every figure computed from ledgers and
 * atomic weekly facts (docs/WORKBOOK_ARITHMETIC.md). All money in ₦m
 * (millions), like the workbook. Data-quality alerts live on the
 * admin Issues tab, not here.
 */

import { useMemo } from 'react'
import { useParams } from 'next/navigation'
import ECharts from 'echarts-for-react'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { useProjectOverview } from '@/hooks/use-projects'
import type { ProjectOverview } from '@/lib/api/projects'
import { fmtDate, naira, nairaM, num, pctFmt, weekLabel } from '@/lib/format'

export default function ProjectOverviewPage() {
  const params = useParams<{ id: string }>()
  const { data: o, isLoading } = useProjectOverview(params.id)

  if (isLoading || !o) return <OverviewSkeleton />
  if (!o.latest_week) return <NoReportsYet />

  return (
    <div className="space-y-4">
      {/* Week banner */}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs text-muted-foreground">
          Tables in <b>₦m</b> (millions), the workbook&apos;s unit — cards show
          the full figure
        </p>
        <p className="text-sm">
          <span className="text-muted-foreground">Week No:</span>{' '}
          <b className="tabular-nums">{o.latest_week.week_number}</b>
          <span className="mx-2 text-muted-foreground">·</span>
          <span className="text-muted-foreground">Report Date:</span>{' '}
          <b className="tabular-nums">{fmtDate(o.latest_week.week_ending_date)}</b>
        </p>
      </div>

      {/* Headline strip */}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-4">
        <Kpi label="Contract Value" value={naira(o.headline.contract_sum, true)}
          sub={naira(o.headline.contract_sum)} lineage="register" />
        <Kpi label="Total BEME" value={naira(o.physical.ladder.works.beme, true)}
          sub={naira(o.physical.ladder.works.beme)}
          lineage="BEME sub-total · priced scope, excl VAT" />
        <Kpi label="Work Done to Date" value={naira(o.physical.ladder.works.to_date, true)}
          sub={naira(o.physical.ladder.works.to_date)}
          lineage="BEME works, excl VAT · previous + stored weeks" />
        <Kpi label="Overall % Complete" value={pctFmt(o.headline.pct_complete)}
          sub={o.progress.reported_pct != null
            ? `workbook reports ${pctFmt(o.progress.reported_pct)}`
            : `${naira(o.physical.ladder.works.to_date, true)} of ${naira(o.physical.ladder.works.beme, true)}`}
          lineage="work done ÷ Total BEME" />
        <Kpi label="Certified to Date"
          value={o.certs_payments.certificates_total ? naira(o.headline.certified_to_date, true) : 'None yet'}
          sub={o.certs_payments.certificates_total ? naira(o.headline.certified_to_date) : 'no certificates recorded'}
          lineage="cert ledger cumulative" />
        <Kpi label="Paid – Gross"
          value={o.certs_payments.payments_count ? naira(o.headline.paid_gross, true) : 'None yet'}
          sub={o.certs_payments.payments_count ? naira(o.headline.paid_gross) : 'no payments recorded'}
          lineage="payments ledger" />
        <Kpi label="Cost to Date" value={naira(o.headline.cost_to_date, true)}
          sub={naira(o.headline.cost_to_date)} lineage="previous + stored weeks" />
        <Kpi label="Net Margin %" value={pctFmt(o.headline.net_margin_pct)}
          sub={`net ${naira(o.cost_profitability.net_to_date, true)} to date`}
          lineage="net ÷ work done incl VAT"
          tone={o.headline.net_margin_pct != null && o.headline.net_margin_pct < 0 ? 'bad' : 'good'} />
      </div>

      <ThisWeekCard o={o} />
      <ScheduleCard o={o} />
      <PhysicalProgressCard o={o} />

      <div className="grid gap-3 lg:grid-cols-3">
        <CertsPaymentsCard o={o} />
        <ResourcesCard o={o} />
      </div>

      <CostProfitabilityCard o={o} />
      <FinancialPositionCard o={o} />
    </div>
  )
}

/* ── This week — the pulse ───────────────────────────────────────────── */

const VAT = 1.075

function Delta({ now, prev, prevLabel, downIsGood, pts }: {
  now: number; prev: number | null; prevLabel: string
  downIsGood?: boolean; pts?: boolean
}) {
  if (prev == null) return null
  const diff = now - prev
  if (pts ? Math.abs(diff) < 0.0005 : prev === 0) {
    return <span className="text-[11px] text-muted-foreground">vs {prevLabel}: —</span>
  }
  const up = diff > 0
  const good = downIsGood ? !up : up
  const label = pts
    ? `${up ? '+' : ''}${(diff * 100).toFixed(1)} pts`
    : `${up ? '+' : ''}${((diff / prev) * 100).toFixed(1)}%`
  return (
    <span className={`text-[11px] font-medium tabular-nums ${good ? 'text-emerald-600' : 'text-red-600'}`}>
      {up ? '▲' : '▼'} {label} vs {prevLabel}
    </span>
  )
}

function ThisWeekCard({ o }: { o: ProjectOverview }) {
  const cp = o.cost_profitability
  const lw = o.latest_week!
  const pw = o.prev_week
  const prevLabel = pw ? `W${String(pw.week_number).padStart(2, '0')}` : ''
  const prevEarnings = pw ? pw.works_this_week * VAT : null
  const prevNet = pw ? pw.works_this_week * VAT - pw.cost_this_week : null
  const prevMargin = pw && pw.works_this_week > 0
    ? prevNet! / (pw.works_this_week * VAT) : null
  const gapWeeks = pw
    ? lw.year === pw.year && lw.week_number - pw.week_number > 1
      ? lw.week_number - pw.week_number - 1 : 0
    : 0

  const compare = [
    { label: 'Work Done (Incl. VAT)', now: cp.works_incl_vat_this_week, prev: prevEarnings },
    { label: 'Cost', now: cp.total_this_week, prev: pw?.cost_this_week ?? null },
  ]
  const maxVal = Math.max(...compare.flatMap((c) => [c.now, c.prev ?? 0]), 1)

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm">
          This week · {weekLabel(lw.year, lw.week_number)}
          <span className="ml-2 font-normal text-muted-foreground">
            w/e {fmtDate(lw.week_ending_date)}
          </span>
        </CardTitle>
        {pw && gapWeeks > 0 && (
          <p className="text-xs text-amber-700">
            Previous stored week is {prevLabel} — {gapWeeks} week{gapWeeks > 1 ? 's' : ''} missing in between
          </p>
        )}
      </CardHeader>
      <CardContent className="grid gap-4 lg:grid-cols-[1fr_340px]">
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <MiniKpi label="Work Done + VAT" value={naira(cp.works_incl_vat_this_week, true)}
            sub={naira(cp.works_incl_vat_this_week)}
            delta={<Delta now={cp.works_incl_vat_this_week} prev={prevEarnings} prevLabel={prevLabel} />} />
          <MiniKpi label="Cost" value={naira(cp.total_this_week, true)}
            sub={naira(cp.total_this_week)}
            delta={<Delta now={cp.total_this_week} prev={pw?.cost_this_week ?? null} prevLabel={prevLabel} downIsGood />} />
          <MiniKpi label="Work Added" value={pctFmt(lw.pct_added, 2)}
            sub="of BEME scope, this week alone"
            delta={pw && lw.pct_added != null
              ? <Delta now={lw.pct_added} prev={o.physical.ladder.works.beme ? pw.works_this_week / o.physical.ladder.works.beme : null} prevLabel={prevLabel} pts />
              : null} />
          <MiniKpi label="Net Margin" value={pctFmt(cp.margin_this_week)}
            sub={`net ${naira(cp.net_this_week, true)} this week`}
            delta={<Delta now={cp.margin_this_week ?? 0} prev={prevMargin} prevLabel={prevLabel} pts />} />
        </div>
        <div className="space-y-3">
          <p className="text-xs font-medium text-muted-foreground">
            {pw ? `This week vs ${prevLabel}` : 'No previous week stored yet'}
          </p>
          {pw && compare.map((c) => (
            <div key={c.label} className="space-y-1">
              <p className="text-xs">{c.label}</p>
              <CompareBar label={weekLabel(lw.year, lw.week_number)} value={c.now} max={maxVal} strong />
              <CompareBar label={prevLabel} value={c.prev ?? 0} max={maxVal} />
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  )
}

function MiniKpi({ label, value, sub, delta }: {
  label: string; value: string; sub?: string; delta?: React.ReactNode
}) {
  return (
    <div className="rounded-lg border p-3">
      <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className="mt-0.5 text-lg font-bold tabular-nums">{value}</p>
      {sub && <p className="truncate text-[11px] tabular-nums text-muted-foreground" title={sub}>{sub}</p>}
      {delta && <div className="mt-0.5">{delta}</div>}
    </div>
  )
}

function CompareBar({ label, value, max, strong }: {
  label: string; value: number; max: number; strong?: boolean
}) {
  return (
    <div className="flex items-center gap-2">
      <span className="w-16 shrink-0 text-[11px] tabular-nums text-muted-foreground">{label}</span>
      <div className="h-3.5 flex-1 overflow-hidden rounded-sm bg-muted">
        <div
          className={`h-full rounded-sm ${strong ? 'bg-amber-500' : 'bg-muted-foreground/40'}`}
          style={{ width: `${Math.max(1.5, (value / max) * 100)}%` }}
        />
      </div>
      <span className="w-20 shrink-0 text-right text-[11px] tabular-nums">{naira(value, true)}</span>
    </div>
  )
}

/* ── Contract & Schedule ─────────────────────────────────────────────── */

function ScheduleCard({ o }: { o: ProjectOverview }) {
  const s = o.schedule
  return (
    <Card>
      <CardHeader className="flex-row items-center justify-between pb-2">
        <CardTitle className="text-sm">Contract &amp; schedule</CardTitle>
        {s.status && (
          <Badge className={s.status === 'overdue'
            ? 'bg-red-100 text-red-700 dark:bg-red-950 dark:text-red-300'
            : 'bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300'}>
            {s.status === 'overdue' ? 'OVERDUE' : 'ON TRACK'}
          </Badge>
        )}
      </CardHeader>
      <CardContent className="grid grid-cols-2 gap-x-6 gap-y-2 text-sm md:grid-cols-3 xl:grid-cols-4">
        <Fact label="Client" value={s.client ?? '—'} wide />
        <Fact label="Original contract sum" value={naira(o.project.original_contract_sum)} />
        <Fact label="Current contract sum" value={naira(o.project.current_contract_sum)} />
        <Fact label="Contract award date" value={fmtDate(s.award_date)} />
        <Fact label="Commencement date" value={fmtDate(s.commencement_date)} />
        <Fact label="Revised completion" value={fmtDate(s.revised_completion_date)} />
        <Fact label="Contract duration" value={s.duration_months != null ? `${num(s.duration_months, 1)} months` : '—'} />
        <Fact label="Months elapsed" value={s.months_elapsed != null ? num(s.months_elapsed, 1) : '—'} />
        <Fact label="Time elapsed vs duration" value={pctFmt(s.time_elapsed_pct, 0)} />
        <Fact label="Months overdue" value={s.months_overdue != null && s.months_overdue > 0 ? num(s.months_overdue, 1) : '—'} />
      </CardContent>
    </Card>
  )
}

/* ── Physical progress — works completed ─────────────────────────────── */

function PhysicalProgressCard({ o }: { o: ProjectOverview }) {
  const L = o.physical.ladder
  const bills = o.physical.bills

  const chartOption = useMemo(() => {
    const rows = [...bills].reverse()
    return {
      tooltip: {
        trigger: 'axis' as const,
        valueFormatter: (v: number) => `${v.toFixed(1)}%`,
      },
      grid: { left: 8, right: 44, top: 8, bottom: 8, containLabel: true },
      xAxis: {
        type: 'value' as const, max: 100,
        axisLabel: { formatter: '{value}%' },
        splitLine: { lineStyle: { opacity: 0.3 } },
      },
      yAxis: {
        type: 'category' as const,
        data: rows.map((b) => titleCase(b.name)),
        axisLabel: { width: 170, overflow: 'truncate' as const, fontSize: 11 },
      },
      series: [{
        type: 'bar' as const,
        data: rows.map((b) => Math.round((b.pct_complete ?? 0) * 1000) / 10),
        barMaxWidth: 14,
        itemStyle: { color: '#f59e0b', borderRadius: [0, 4, 4, 0] },
        label: {
          show: true, position: 'right' as const, fontSize: 11,
          formatter: ({ value }: { value: number }) => `${value}%`,
        },
      }],
    }
  }, [bills])

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm">Physical progress — works completed</CardTitle>
        <p className="text-xs text-muted-foreground">
          Work sections from the BEME sheet · to-date = previous + stored weeks
          (kobo-exact vs the workbook&apos;s own cumulative)
        </p>
      </CardHeader>
      <CardContent className="grid gap-4 p-0 lg:grid-cols-[1fr_360px] lg:items-start">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b text-left text-xs text-muted-foreground">
                <th className="px-4 py-2 font-medium">Work Section</th>
                <th className="px-4 py-2 text-right font-medium">BEME (₦m)</th>
                <th className="px-4 py-2 text-right font-medium">This Week (₦m)</th>
                <th className="px-4 py-2 text-right font-medium">To Date (₦m)</th>
                <th className="px-4 py-2 text-right font-medium">% Complete</th>
              </tr>
            </thead>
            <tbody>
              {bills.map((b) => (
                <tr key={b.bill_code ?? b.name} className="border-b">
                  <td className="max-w-[280px] truncate px-4 py-1.5">{titleCase(b.name)}</td>
                  <td className="px-4 py-1.5 text-right tabular-nums">{nairaM(b.beme_amount)}</td>
                  <td className="px-4 py-1.5 text-right tabular-nums">{nairaM(b.this_week)}</td>
                  <td className="px-4 py-1.5 text-right tabular-nums">{nairaM(b.to_date)}</td>
                  <td className={`px-4 py-1.5 text-right tabular-nums ${(b.pct_complete ?? 0) > 1 ? 'font-semibold text-red-600' : ''}`}>
                    {pctFmt(b.pct_complete)}
                  </td>
                </tr>
              ))}
              <LadderRow label="Sub-Total" r={L.works} bold />
              <LadderRow label="Add VAT & State Levies (7.5%)" r={L.vat} />
              <LadderRow label="Total Works Completed (Incl. VAT)" r={L.works_incl_vat} bold />
              <LadderRow label="Contingency (Incl. VAT)" r={L.contingency_incl_vat}
                note="accrual: BEME tail sub-total₂ − sub-total₁, × 1.075" />
              <LadderRow label="TOTAL WORKS DONE (Incl. VAT & Contingency)" r={L.total_incl_contingency} bold />
            </tbody>
          </table>
        </div>
        <div className="px-4 pb-4 lg:pt-2">
          <p className="mb-1 text-xs font-medium text-muted-foreground">% Complete by Work Section</p>
          <ECharts option={chartOption} style={{ height: Math.max(200, bills.length * 34 + 30) }} notMerge />
        </div>
      </CardContent>
    </Card>
  )
}

function LadderRow({ label, r, bold, note }: {
  label: string
  r: { beme: number | null; this_week: number | null; to_date: number | null }
  bold?: boolean
  note?: string
}) {
  const pct = r.beme && r.to_date != null ? r.to_date / r.beme : null
  return (
    <tr className={`border-b last:border-0 ${bold ? 'bg-muted/40 font-semibold' : ''}`}>
      <td className="px-4 py-1.5" title={note}>{label}</td>
      <td className="px-4 py-1.5 text-right tabular-nums">{nairaM(r.beme)}</td>
      <td className="px-4 py-1.5 text-right tabular-nums">{nairaM(r.this_week)}</td>
      <td className="px-4 py-1.5 text-right tabular-nums">{nairaM(r.to_date)}</td>
      <td className="px-4 py-1.5 text-right tabular-nums">{pctFmt(pct)}</td>
    </tr>
  )
}

/* ── Certificates & payments ─────────────────────────────────────────── */

function CertsPaymentsCard({ o }: { o: ProjectOverview }) {
  const c = o.certs_payments
  const young = c.certificates_total === 0 && c.payments_count === 0
  return (
    <Card className="lg:col-span-2">
      <CardHeader className="pb-2">
        <CardTitle className="text-sm">Certificates &amp; payments</CardTitle>
        <p className="text-xs text-muted-foreground">
          Certificate + payments ledgers only — never the Contract Summary&apos;s
          frozen client block
        </p>
      </CardHeader>
      <CardContent>
        {young ? (
          <p className="py-3 text-xs text-muted-foreground">
            No certificates or payments recorded yet — young ledger.
          </p>
        ) : (
          <div className="grid gap-x-8 gap-y-1.5 text-sm md:grid-cols-2">
            <MoneyRow label="Certificates (No.)" text={String(c.certificates_total)} />
            <MoneyRow label="Advance Received" v={c.advance_received} />
            <MoneyRow label="Total Certified" v={c.certified_to_date} />
            <MoneyRow label="Advance Recovered" v={c.advance_recovered} />
            <MoneyRow label="Payments Received – Gross" v={c.payments_gross} />
            <MoneyRow label="Advance Outstanding" v={c.advance_outstanding} />
            <MoneyRow label="Payments Received – Net" v={c.payments_net} />
            <MoneyRow label="Retention Held" v={c.retention_held} />
            <MoneyRow label="Certified – Not Yet Paid" v={c.certified_not_paid}
              note="certified − cert-type payments (advances excluded)" />
            <MoneyRow label="% of Certified Value Paid" text={pctFmt(c.pct_certified_paid)} />
          </div>
        )}
      </CardContent>
    </Card>
  )
}

/* ── Resources (this week) ───────────────────────────────────────────── */

function ResourcesCard({ o }: { o: ProjectOverview }) {
  const r = o.resources
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm">Resources · this week</CardTitle>
        <p className="text-xs text-muted-foreground">Labour Strength + Diesel sheets, latest week</p>
      </CardHeader>
      <CardContent className="space-y-1.5 text-sm">
        <MoneyRow label="Direct Labour Headcount" text={num(r.labour_direct)} />
        <MoneyRow label="Casual Labour Headcount" text={num(r.labour_casual)} />
        <MoneyRow label="Diesel Used This Week (L)" text={num(r.diesel_litres_week)} />
        <MoneyRow label="Diesel Cost This Week" v={r.diesel_cost_week}
          note="Cost Report AGO row — the money truth" />
      </CardContent>
    </Card>
  )
}

/* ── Cost & profitability ────────────────────────────────────────────── */

const DONUT_COLORS = ['#94a3b8', '#f59e0b', '#3b82f6', '#10b981', '#8b5cf6', '#f43f5e', '#14b8a6', '#eab308']

function CostProfitabilityCard({ o }: { o: ProjectOverview }) {
  const cp = o.cost_profitability

  const donutOption = useMemo(() => ({
    tooltip: {
      trigger: 'item' as const,
      valueFormatter: (v: number) => `₦${nairaM(v)}m`,
    },
    legend: {
      orient: 'vertical' as const, right: 0, top: 'middle',
      textStyle: { fontSize: 11 }, itemWidth: 10, itemHeight: 10,
    },
    series: [{
      type: 'pie' as const, radius: ['52%', '78%'], center: ['32%', '50%'],
      itemStyle: { borderWidth: 2, borderColor: 'transparent' },
      label: { show: false },
      data: cp.categories.map((c, i) => ({
        name: c.category, value: Math.round(c.to_date),
        itemStyle: { color: DONUT_COLORS[i % DONUT_COLORS.length] },
      })),
    }],
  }), [cp.categories])

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm">Cost &amp; profitability</CardTitle>
        <p className="text-xs text-muted-foreground">
          Cost Report categories · to-date = previous + stored weeks ·
          net earnings = work done incl VAT (excl contingency) − costs — the
          Weekly Summary definition
        </p>
      </CardHeader>
      <CardContent className="grid gap-4 p-0 lg:grid-cols-[1fr_380px] lg:items-center">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b text-left text-xs text-muted-foreground">
                <th className="px-4 py-2 font-medium">Cost Category</th>
                <th className="px-4 py-2 text-right font-medium">This Week (₦m)</th>
                <th className="px-4 py-2 text-right font-medium">To Date (₦m)</th>
                <th className="px-4 py-2 text-right font-medium">% of Total Cost</th>
              </tr>
            </thead>
            <tbody>
              {cp.categories.map((c) => (
                <tr key={c.category} className="border-b">
                  <td className="px-4 py-1.5">{c.category}</td>
                  <td className="px-4 py-1.5 text-right tabular-nums">{nairaM(c.this_week)}</td>
                  <td className="px-4 py-1.5 text-right tabular-nums">{nairaM(c.to_date)}</td>
                  <td className="px-4 py-1.5 text-right tabular-nums">{pctFmt(c.pct_of_total)}</td>
                </tr>
              ))}
              <tr className="border-b bg-muted/40 font-semibold">
                <td className="px-4 py-1.5">Total Costs to Date</td>
                <td className="px-4 py-1.5 text-right tabular-nums">{nairaM(cp.total_this_week)}</td>
                <td className="px-4 py-1.5 text-right tabular-nums">{nairaM(cp.total_to_date)}</td>
                <td className="px-4 py-1.5 text-right tabular-nums">100.0%</td>
              </tr>
              <tr className="border-b">
                <td className="px-4 py-1.5">Value of Work Done — Incl. VAT, Excl. Contingency</td>
                <td className="px-4 py-1.5 text-right tabular-nums">{nairaM(cp.works_incl_vat_this_week)}</td>
                <td className="px-4 py-1.5 text-right tabular-nums">{nairaM(cp.works_incl_vat_to_date)}</td>
                <td className="px-4 py-1.5" />
              </tr>
              <tr className="border-b bg-muted/40 font-semibold">
                <td className="px-4 py-1.5">Net Earnings (₦m)</td>
                <td className={`px-4 py-1.5 text-right tabular-nums ${cp.net_this_week < 0 ? 'text-red-600' : 'text-emerald-700 dark:text-emerald-400'}`}>
                  {nairaM(cp.net_this_week)}
                </td>
                <td className={`px-4 py-1.5 text-right tabular-nums ${cp.net_to_date < 0 ? 'text-red-600' : 'text-emerald-700 dark:text-emerald-400'}`}>
                  {nairaM(cp.net_to_date)}
                </td>
                <td className="px-4 py-1.5" />
              </tr>
              <tr>
                <td className="px-4 py-1.5 font-semibold">Net Margin %</td>
                <td className="px-4 py-1.5 text-right font-semibold tabular-nums">{pctFmt(cp.margin_this_week)}</td>
                <td className="px-4 py-1.5 text-right font-semibold tabular-nums">{pctFmt(cp.margin_to_date)}</td>
                <td className="px-4 py-1.5" />
              </tr>
            </tbody>
          </table>
        </div>
        <div className="px-4 pb-4">
          <p className="mb-1 text-xs font-medium text-muted-foreground">Cost to Date by Category (₦m)</p>
          <ECharts option={donutOption} style={{ height: 230 }} notMerge />
        </div>
      </CardContent>
    </Card>
  )
}

/* ── Financial position ──────────────────────────────────────────────── */

function FinancialPositionCard({ o }: { o: ProjectOverview }) {
  const cp = o.cost_profitability
  const bars = useMemo(() => ([
    { label: 'Contract Value', value: o.headline.contract_sum },
    { label: 'Work Done (Incl. VAT)', value: cp.works_incl_vat_to_date },
    { label: 'Certified', value: o.certs_payments.certified_to_date },
    { label: 'Paid – Gross', value: o.certs_payments.payments_gross },
    { label: 'Cost to Date', value: cp.total_to_date },
    { label: 'Net Earnings', value: cp.net_to_date },
  ]), [o, cp])

  const option = useMemo(() => ({
    tooltip: {
      trigger: 'axis' as const,
      valueFormatter: (v: number) => `₦${nairaM(v)}m`,
    },
    grid: { left: 8, right: 8, top: 28, bottom: 8, containLabel: true },
    xAxis: {
      type: 'category' as const,
      data: bars.map((b) => b.label),
      axisLabel: { fontSize: 11, interval: 0 },
    },
    yAxis: {
      type: 'value' as const,
      axisLabel: { formatter: (v: number) => num(v / 1e6) },
      splitLine: { lineStyle: { opacity: 0.3 } },
    },
    series: [{
      type: 'bar' as const,
      data: bars.map((b) => Math.round(b.value)),
      barMaxWidth: 46,
      itemStyle: { color: '#f59e0b', borderRadius: [4, 4, 0, 0] },
      label: {
        show: true, position: 'top' as const, fontSize: 11,
        formatter: ({ value }: { value: number }) => nairaM(value, 0),
      },
    }],
  }), [bars])

  return (
    <Card>
      <CardHeader className="pb-0">
        <CardTitle className="text-sm">Financial position (₦m)</CardTitle>
      </CardHeader>
      <CardContent>
        <ECharts option={option} style={{ height: 280 }} notMerge />
      </CardContent>
    </Card>
  )
}

/* ── shared bits ─────────────────────────────────────────────────────── */

function Kpi({ label, value, sub, lineage, tone }: {
  label: string; value: string; sub?: string; lineage: string; tone?: 'good' | 'bad'
}) {
  return (
    <Card>
      <CardContent className="p-3.5">
        <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">{label}</p>
        <p className={`mt-0.5 text-xl font-bold tabular-nums ${
          tone === 'bad' ? 'text-red-600' : tone === 'good' ? 'text-emerald-700 dark:text-emerald-400' : ''
        }`}>{value}</p>
        {sub && <p className="truncate text-xs tabular-nums text-muted-foreground" title={sub}>{sub}</p>}
        <p className="mt-0.5 truncate text-[11px] text-muted-foreground" title={lineage}>{lineage}</p>
      </CardContent>
    </Card>
  )
}

function Fact({ label, value, wide }: { label: string; value: string; wide?: boolean }) {
  return (
    <div className={wide ? 'col-span-2 md:col-span-3 xl:col-span-2' : ''}>
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="font-medium tabular-nums">{value}</p>
    </div>
  )
}

function MoneyRow({ label, v, text, note }: {
  label: string; v?: number; text?: string; note?: string
}) {
  return (
    <div className="flex items-baseline justify-between gap-3 border-b border-dashed pb-1 last:border-0" title={note}>
      <span className="text-muted-foreground">{label}</span>
      <span className="font-medium tabular-nums">{text ?? naira(v)}</span>
    </div>
  )
}

const titleCase = (s: string): string =>
  s.replace(/\w\S*/g, (w) => w[0].toUpperCase() + w.slice(1).toLowerCase())

function OverviewSkeleton() {
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
        {Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-24" />)}
      </div>
      <Skeleton className="h-40" />
      <Skeleton className="h-96" />
      <Skeleton className="h-64" />
    </div>
  )
}

function NoReportsYet() {
  return (
    <Card>
      <CardContent className="py-12 text-center">
        <p className="font-medium">No weekly reports yet</p>
        <p className="mt-1 text-sm text-muted-foreground">
          Upload the first 16-sheet workbook on the Submissions tab — the
          dashboard builds itself from the parsed ledgers.
        </p>
      </CardContent>
    </Card>
  )
}
