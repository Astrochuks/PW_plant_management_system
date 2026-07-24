'use client'

/**
 * Overview — the PROJECT KPI DASHBOARD. Mirrors the company's Excel
 * dashboard block-for-block; every figure computed from ledgers and
 * atomic weekly facts (docs/WORKBOOK_ARITHMETIC.md). Tables in ₦m
 * (the workbook's unit); cards show full figures. Data-quality alerts
 * live on the admin Issues tab, not here.
 *
 * Color system: PW amber (#f59e0b) is THE accent — progress, this-week
 * emphasis, totals. Cost categories carry a FIXED per-name palette
 * (never index-cycled) shared by the donut and its table dots.
 */

import { useEffect, useMemo, useState } from 'react'
import { useParams } from 'next/navigation'
import ECharts from 'echarts-for-react'
import {
  Banknote, ChevronDown, HardHat, Percent, TrendingUp, Wallet,
} from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { useProjectOverview } from '@/hooks/use-projects'
import type { ProjectOverview } from '@/lib/api/projects'
import { categoryColor, Delta, Kpi, Legend, LegendSm } from '@/components/projects/hub-ui'
import { fmtDate, naira, nairaM, num, pctFmt, weekLabel } from '@/lib/format'

type MoneyUnit = 'm' | 'full'

export default function ProjectOverviewPage() {
  const params = useParams<{ id: string }>()
  const { data: o, isLoading } = useProjectOverview(params.id)
  const [unit, setUnitState] = useState<MoneyUnit>('full')
  useEffect(() => {
    const v = localStorage.getItem('hub-money-unit')
    if (v === 'm' || v === 'full') setUnitState(v)
  }, [])
  const setUnit = (v: MoneyUnit) => {
    setUnitState(v)
    localStorage.setItem('hub-money-unit', v)
  }

  if (isLoading || !o) return <OverviewSkeleton />

  // A brand-new project has its contract details & schedule (entered at
  // creation) but no weekly reports yet — show the contract card, then a
  // note in place of the data sections that need uploaded weeks.
  if (!o.latest_week) {
    return (
      <div className="space-y-6">
        <ContractCard o={o} />
        <NoReportsYet />
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <ContractCard o={o} />

      {/* Headline strip */}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-4">
        <Kpi label="Contract Value" value={naira(o.headline.contract_sum, true)}
          sub={naira(o.headline.contract_sum)} />
        <Kpi label="Total BEME (Incl. VAT)" value={naira(o.physical.ladder.works_incl_vat.beme, true)}
          sub={naira(o.physical.ladder.works_incl_vat.beme)} />
        <Kpi label="Work Done to Date (Incl. VAT)" value={naira(o.physical.ladder.works_incl_vat.to_date, true)}
          sub={naira(o.physical.ladder.works_incl_vat.to_date)} />
        <Kpi label="Overall % Complete" value={pctFmt(o.headline.pct_complete)}
          sub={o.progress.reported_pct != null
            ? `workbook reports ${pctFmt(o.progress.reported_pct)}`
            : `${naira(o.physical.ladder.works.to_date, true)} of ${naira(o.physical.ladder.works.beme, true)}`} />
        <Kpi label="Certified to Date"
          value={o.certs_payments.certificates_total ? naira(o.headline.certified_to_date, true) : 'None yet'}
          sub={o.certs_payments.certificates_total ? naira(o.headline.certified_to_date) : 'no certificates recorded'} />
        <Kpi label="Paid – Gross"
          value={o.certs_payments.payments_count ? naira(o.headline.paid_gross, true) : 'None yet'}
          sub={o.certs_payments.payments_count ? naira(o.headline.paid_gross) : 'no payments recorded'} />
        <Kpi label="Cost to Date" value={naira(o.headline.cost_to_date, true)}
          sub={naira(o.headline.cost_to_date)} />
        <Kpi label="Net Margin %" value={pctFmt(o.headline.net_margin_pct)}
          sub={`net ${naira(o.cost_profitability.net_to_date, true)} to date`}
          tone={o.headline.net_margin_pct != null && o.headline.net_margin_pct < 0 ? 'bad' : 'good'} />
      </div>

      <ThisWeekCard o={o} />
      <PhysicalProgressCard o={o} unit={unit} onUnit={setUnit} />

      <div className="grid gap-3 lg:grid-cols-3">
        <CertsPaymentsCard o={o} />
        <ResourcesCard o={o} />
      </div>

      <CostProfitabilityCard o={o} unit={unit} onUnit={setUnit} />
    </div>
  )
}

/* ── Contract details & schedule — the workbook's own blocks ────────── */

function ContractCard({ o }: { o: ProjectOverview }) {
  const s = o.schedule
  const overdue = s.status === 'overdue'
  const pct = o.headline.pct_complete ?? 0

  return (
    <Card className="relative">
      <Legend>Contract details &amp; schedule</Legend>
      <CardContent className="space-y-6 pt-1">
        {/* Overall progress */}
        <div>
          <div className="mb-1.5 flex items-baseline justify-between">
            <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
              Overall % Complete
            </p>
            <p className="text-2xl font-bold tabular-nums text-emerald-600 dark:text-emerald-400">
              {pctFmt(o.headline.pct_complete)}
            </p>
          </div>
          <div className="relative h-3.5 w-full overflow-hidden rounded-full bg-muted">
            <div
              className="h-full rounded-full bg-gradient-to-r from-emerald-400 to-emerald-500 transition-all"
              style={{ width: `${Math.min(100, pct * 100)}%` }}
            />
            <div
              className="absolute top-0 h-full w-0.5 bg-background/80"
              style={{ left: `calc(${Math.min(100, pct * 100)}% - 1px)` }}
            />
          </div>
          <p className="mt-1 text-[11px] tabular-nums text-muted-foreground">
            Work done {naira(o.physical.ladder.works_incl_vat.to_date, true)} of
            Total BEME {naira(o.physical.ladder.works_incl_vat.beme, true)} (Incl. VAT)
          </p>
        </div>

        <div className="grid items-start gap-x-10 gap-y-5 lg:grid-cols-2">
          {/* CONTRACT DETAILS — workbook block */}
          <CollapsibleBlock
            title="Contract details"
            preview={
              <>
                <KvBlock label="Client:" value={s.client ?? '—'} />
                <KvBlock label="Name of Contract:" value={o.project.project_name} />
              </>
            }
          >
            <KvBlock label="Short Name:" value={o.project.short_name ?? '—'} />
            <KvRow label="Original Contract Amount:" value={naira(o.project.original_contract_sum)} />
            <KvRow label="Current Contract Amount:" value={naira(o.project.current_contract_sum)}
              extra={<Badge variant="outline" className="ml-2 text-[10px]">RETC: {o.project.retc == null ? '—' : o.project.retc ? 'Yes' : 'No'}</Badge>} />
          </CollapsibleBlock>

          {/* CONTRACT SCHEDULES — workbook block */}
          <CollapsibleBlock
            title="Contract schedules"
            preview={
              <>
                <KvRow label="Date of Contract Award:" value={fmtDate(s.award_date)} />
                <KvRow label="Overdue to Revised Completion Date:"
                  value={s.overdue_revised_months != null && s.overdue_revised_months > 0
                    ? `${num(s.overdue_revised_months, 1)} Mths` : '—'}
                  bad={s.overdue_revised_months != null && s.overdue_revised_months > 0} />
              </>
            }
          >
            <div className="grid gap-x-8 gap-y-2 sm:grid-cols-2">
              <div className="space-y-2">
                <KvRow label="Contract Commencement Date:" value={fmtDate(s.commencement_date)} />
                <KvRow label="Original Contract Duration (Months):"
                  value={s.original_duration_months != null ? num(s.original_duration_months, 0) : '—'} />
                <KvRow label="Original Contract Completion Date:" value={fmtDate(s.original_completion_date)} />
                <KvRow label="Extension of Time Requested (Months):"
                  value={s.eot_requested_months != null ? num(s.eot_requested_months, 0) : '0'} />
                <KvRow label="Extension of Time Granted (Months):"
                  value={s.eot_granted_months != null ? num(s.eot_granted_months, 0) : '0'} />
              </div>
              <div className="space-y-2">
                <KvRow label="Revised Contract Duration (Months):"
                  value={s.revised_duration_months != null ? num(s.revised_duration_months, 0) : '—'} />
                <KvRow label="Revised Completion Date:" value={fmtDate(s.revised_completion_date)} />
                <KvRow label="Works Actually Commenced on Site:" value={fmtDate(s.works_commenced_date)} />
                <KvRow label="Duration Already on Site:"
                  value={`${(s.duration_on_site_months ?? 0).toFixed(1)} Mths`} />
                <KvRow label="Overdue to Original Completion Date:"
                  value={s.overdue_original_months != null && s.overdue_original_months > 0
                    ? `${num(s.overdue_original_months, 1)} Mths` : '—'}
                  bad={s.overdue_original_months != null && s.overdue_original_months > 0} />
              </div>
            </div>
          </CollapsibleBlock>
        </div>
      </CardContent>
    </Card>
  )
}

/* Collapsed by default: the preview rows show, the rest slides open.
   Grid-rows animation — smooth height without max-height guesswork. */
function CollapsibleBlock({ title, preview, children }: {
  title: string
  preview: React.ReactNode
  children: React.ReactNode
}) {
  const [open, setOpen] = useState(false)
  return (
    <div>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="mb-2 flex w-full items-center justify-between border-b pb-1 text-left"
        aria-expanded={open}
      >
        <span className="text-[11px] font-bold uppercase tracking-wide text-foreground">
          {title}
        </span>
        <span className="flex items-center gap-1 rounded-md border bg-background px-2 py-0.5 text-[11px] font-bold shadow-sm transition-all hover:-translate-y-px hover:bg-muted hover:shadow">
          {open ? 'Hide' : 'Show all'}
          <ChevronDown className={`h-3.5 w-3.5 transition-transform duration-300 ${open ? 'rotate-180' : ''}`} />
        </span>
      </button>
      <div className="space-y-2 text-sm">{preview}</div>
      <div
        className={`grid transition-all duration-300 ease-in-out ${
          open ? 'mt-2 grid-rows-[1fr] opacity-100' : 'grid-rows-[0fr] opacity-0'
        }`}
      >
        <div className="overflow-hidden">
          <div className="space-y-2 text-sm">{children}</div>
        </div>
      </div>
    </div>
  )
}

function KvRow({ label, value, extra, bad }: {
  label: string; value: string; extra?: React.ReactNode; bad?: boolean
}) {
  return (
    <div className="flex items-baseline justify-between gap-4 border-b border-dashed pb-1">
      <span className="text-muted-foreground">{label}</span>
      <span className={`shrink-0 text-right font-medium tabular-nums ${bad ? 'font-semibold text-red-600' : ''}`}>
        {value}{extra}
      </span>
    </div>
  )
}

function KvBlock({ label, value }: { label: string; value: string }) {
  return (
    <div className="border-b border-dashed pb-1">
      <span className="text-muted-foreground">{label}</span>{' '}
      <span className="font-medium">{value}</span>
    </div>
  )
}

/* ── This week — the pulse ───────────────────────────────────────────── */

const VAT = 1.075

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
    <Card className="relative">
      <Legend>This week · {weekLabel(lw.year, lw.week_number)}</Legend>
      <CardContent className="space-y-3 pt-6">
        {pw && gapWeeks > 0 && (
          <p className="text-xs text-amber-700">
            Previous stored week is {prevLabel} — {gapWeeks} week{gapWeeks > 1 ? 's' : ''} missing in between
          </p>
        )}
        <div className="space-y-4">
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <MiniKpi icon={HardHat} iconClass="bg-amber-500/10 text-amber-600"
            label="Work Done + VAT" value={naira(cp.works_incl_vat_this_week, true)}
            sub={naira(cp.works_incl_vat_this_week)}
            delta={<Delta now={cp.works_incl_vat_this_week} prev={prevEarnings} prevLabel={prevLabel} />} />
          <MiniKpi icon={Wallet} iconClass="bg-blue-500/10 text-blue-600"
            label="Cost" value={naira(cp.total_this_week, true)}
            sub={naira(cp.total_this_week)}
            delta={<Delta now={cp.total_this_week} prev={pw?.cost_this_week ?? null} prevLabel={prevLabel} downIsGood />} />
          <MiniKpi icon={TrendingUp} iconClass="bg-violet-500/10 text-violet-600"
            label="Work Added" value={pctFmt(lw.pct_added, 2)}
            sub="of BEME scope, this week alone"
            delta={pw && lw.pct_added != null
              ? <Delta now={lw.pct_added} prev={o.physical.ladder.works.beme ? pw.works_this_week / o.physical.ladder.works.beme : null} prevLabel={prevLabel} pts dp={2} />
              : null} />
          <MiniKpi icon={Percent}
            iconClass={cp.net_this_week < 0 ? 'bg-red-500/10 text-red-600' : 'bg-emerald-500/10 text-emerald-600'}
            label="Net Margin" value={pctFmt(cp.margin_this_week)}
            sub={`net ${naira(cp.net_this_week, true)} this week`}
            delta={<Delta now={cp.margin_this_week ?? 0} prev={prevMargin} prevLabel={prevLabel} pts />} />
        </div>
        <div className="relative rounded-lg border bg-muted/30 p-4 pt-5">
          <LegendSm>{pw ? `This week vs ${prevLabel}` : 'No previous week yet'}</LegendSm>
          <div className="space-y-4">
            {pw && compare.map((c) => {
              const change = c.prev ? ((c.now - c.prev) / c.prev) * 100 : null
              return (
                <div key={c.label} className="space-y-1">
                  <div className="flex items-baseline justify-between">
                    <p className="text-xs font-medium">{c.label}</p>
                    {change != null && (
                      <span className="text-[11px] tabular-nums text-muted-foreground">
                        {change > 0 ? '+' : ''}{change.toFixed(1)}%
                      </span>
                    )}
                  </div>
                  <CompareBar label={`W${String(lw.week_number).padStart(2, '0')}`} value={c.now} max={maxVal} strong />
                  <CompareBar label={prevLabel} value={c.prev ?? 0} max={maxVal} />
                </div>
              )
            })}
          </div>
        </div>
        </div>
      </CardContent>
    </Card>
  )
}

function MiniKpi({ icon: Icon, iconClass, label, value, sub, delta }: {
  icon: React.ComponentType<{ className?: string }>
  iconClass: string
  label: string; value: string; sub?: string; delta?: React.ReactNode
}) {
  return (
    <div className="rounded-lg bg-muted/40 p-3">
      <div className="flex items-center gap-2">
        <span className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-md ${iconClass}`}>
          <Icon className="h-4 w-4" />
        </span>
        <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">{label}</p>
      </div>
      <p className="mt-2 text-lg font-bold tabular-nums">{value}</p>
      {sub && <p className="truncate text-[11px] tabular-nums text-muted-foreground" title={sub}>{sub}</p>}
      {delta && <div className="mt-1.5">{delta}</div>}
    </div>
  )
}

function CompareBar({ label, value, max, strong }: {
  label: string; value: number; max: number; strong?: boolean
}) {
  return (
    <div className="flex items-center gap-2">
      <span className="w-10 shrink-0 text-[11px] font-medium tabular-nums text-muted-foreground">{label}</span>
      <div className="h-4 flex-1 overflow-hidden rounded-sm bg-muted">
        <div
          className={`h-full rounded-sm ${strong ? 'bg-amber-500' : 'bg-slate-400/50 dark:bg-slate-500/50'}`}
          style={{ width: `${Math.max(1.5, (value / max) * 100)}%` }}
        />
      </div>
      <span className={`w-20 shrink-0 text-right text-[11px] tabular-nums ${strong ? 'font-semibold' : 'text-muted-foreground'}`}>
        {naira(value, true)}
      </span>
    </div>
  )
}

/* ── money-unit machinery for the tables ─────────────────────────────── */

const tableMoney = (unit: MoneyUnit) =>
  (v: number | null | undefined): string =>
    v == null ? '—'
    : unit === 'm' ? nairaM(v)
    : Math.round(v).toLocaleString('en-NG')

const unitLabel = (unit: MoneyUnit) => (unit === 'm' ? '₦m' : '₦')

function UnitToggle({ unit, onUnit }: {
  unit: MoneyUnit; onUnit: (v: MoneyUnit) => void
}) {
  return (
    <span className="absolute -top-3 right-4 z-10 inline-flex overflow-hidden rounded-md border bg-card text-[11px] font-bold shadow-sm">
      {(['m', 'full'] as const).map((u) => (
        <button
          key={u}
          type="button"
          onClick={() => onUnit(u)}
          className={`px-2 py-0.5 transition-colors ${
            unit === u ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:bg-muted'
          }`}
        >
          {u === 'm' ? '₦m' : 'Full'}
        </button>
      ))}
    </span>
  )
}

/* ── Physical progress — works completed ─────────────────────────────── */

function PhysicalProgressCard({ o, unit, onUnit }: {
  o: ProjectOverview; unit: MoneyUnit; onUnit: (v: MoneyUnit) => void
}) {
  const L = o.physical.ladder
  const bills = o.physical.bills
  const fm = tableMoney(unit)
  const ul = unitLabel(unit)

  const chartOption = useMemo(() => {
    const rows = [...bills].reverse()
    return {
      tooltip: {
        trigger: 'axis' as const,
        valueFormatter: (v: number) => `${v.toFixed(1)}%`,
      },
      grid: { left: 8, right: 48, top: 4, bottom: 4, containLabel: true },
      xAxis: {
        type: 'value' as const, max: 100,
        axisLabel: { show: false }, axisTick: { show: false },
        splitLine: { show: false },
      },
      yAxis: {
        type: 'category' as const,
        data: rows.map((b) => titleCase(b.name)),
        axisLine: { show: false }, axisTick: { show: false },
        axisLabel: { width: 165, overflow: 'truncate' as const, fontSize: 11 },
      },
      series: [{
        type: 'bar' as const,
        data: rows.map((b) => Math.round((b.pct_complete ?? 0) * 1000) / 10),
        barMaxWidth: 12,
        showBackground: true,
        backgroundStyle: { color: 'rgba(148, 163, 184, 0.12)', borderRadius: 6 },
        itemStyle: { color: '#f59e0b', borderRadius: 6 },
        label: {
          show: true, position: 'right' as const, fontSize: 11,
          formatter: ({ value }: { value: number }) => `${value}%`,
        },
      }],
    }
  }, [bills])

  return (
    <Card className="relative">
      <Legend>Physical progress — works completed</Legend>
      <UnitToggle unit={unit} onUnit={onUnit} />
      <CardContent className="p-0 pt-4">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[600px] text-sm">
            <thead>
              <tr className="border-b bg-primary text-primary-foreground text-left text-[11px] uppercase tracking-wide">
                <th className="whitespace-nowrap px-4 py-2 font-bold">Work Section</th>
                <th className="whitespace-nowrap px-4 py-2 text-right font-bold">BEME ({ul})</th>
                <th className="whitespace-nowrap px-4 py-2 text-right font-bold">Last Wk ({ul})</th>
                <th className="whitespace-nowrap px-4 py-2 text-right font-bold">This Wk ({ul})</th>
                <th className="whitespace-nowrap px-4 py-2 text-right font-bold">To Date ({ul})</th>
                <th className="whitespace-nowrap px-4 py-2 text-right font-bold">% Complete</th>
              </tr>
            </thead>
            <tbody>
              {bills.map((b, i) => (
                <tr key={b.bill_code ?? b.name}
                  className={`border-b ${i % 2 ? 'bg-muted/20' : ''}`}>
                  <td className="max-w-[280px] truncate px-4 py-1.5">{titleCase(b.name)}</td>
                  <td className="px-4 py-1.5 text-right tabular-nums">{fm(b.beme_amount)}</td>
                  <td className="px-4 py-1.5 text-right tabular-nums text-muted-foreground">{fm(b.last_week)}</td>
                  <td className={`px-4 py-1.5 text-right tabular-nums ${b.this_week > 0 ? 'font-medium text-amber-700 dark:text-amber-400' : ''}`}>
                    {fm(b.this_week)}
                  </td>
                  <td className="px-4 py-1.5 text-right tabular-nums">{fm(b.to_date)}</td>
                  <td className={`px-4 py-1.5 text-right tabular-nums ${(b.pct_complete ?? 0) > 1 ? 'font-semibold text-red-600' : ''}`}>
                    {pctFmt(b.pct_complete)}
                  </td>
                </tr>
              ))}
              <LadderRow fm={fm} label="Sub-Total" r={L.works} tone="subtotal" />
              <LadderRow fm={fm} label="Add VAT & State Levies (7.5%)" r={L.vat} />
              <LadderRow fm={fm} label="Total Works Completed (Incl. VAT)" r={L.works_incl_vat} tone="subtotal" />
              <LadderRow fm={fm} label="Contingency (Incl. VAT)" r={L.contingency_incl_vat}
                note="accrual: BEME tail sub-total₂ − sub-total₁, × 1.075" />
              <LadderRow fm={fm} label="TOTAL WORKS DONE (Incl. VAT & Contingency)"
                r={L.total_incl_contingency} tone="total" />
            </tbody>
          </table>
        </div>
        <div className="px-4 pb-4 pt-5">
          <p className="mb-2 text-xs font-bold uppercase tracking-wide">% Complete by Work Section</p>
          <ECharts option={chartOption} style={{ height: Math.max(200, bills.length * 32 + 20) }} notMerge />
        </div>
      </CardContent>
    </Card>
  )
}


function LadderRow({ fm, label, r, tone, note }: {
  fm: (v: number | null | undefined) => string
  label: string
  r: { beme: number | null; last_week: number | null; this_week: number | null; to_date: number | null }
  tone?: 'subtotal' | 'total'
  note?: string
}) {
  const pct = r.beme && r.to_date != null ? r.to_date / r.beme : null
  const rowClass = tone === 'total'
    ? 'border-t-2 border-amber-500/50 bg-amber-500/10 font-bold'
    : tone === 'subtotal'
      ? 'bg-amber-500/5 font-semibold'
      : ''
  return (
    <tr className={`border-b last:border-0 ${rowClass}`}>
      <td className="px-4 py-2" title={note}>{label}</td>
      <td className="px-4 py-2 text-right tabular-nums">{fm(r.beme)}</td>
      <td className="px-4 py-2 text-right tabular-nums text-muted-foreground">{fm(r.last_week)}</td>
      <td className="px-4 py-2 text-right tabular-nums">{fm(r.this_week)}</td>
      <td className="px-4 py-2 text-right tabular-nums">{fm(r.to_date)}</td>
      <td className="px-4 py-2 text-right tabular-nums">{pctFmt(pct)}</td>
    </tr>
  )
}

/* ── Certificates & payments ─────────────────────────────────────────── */

function CertsPaymentsCard({ o }: { o: ProjectOverview }) {
  const c = o.certs_payments
  const young = c.certificates_total === 0 && c.payments_count === 0
  return (
    <Card className="relative lg:col-span-2">
      <Legend>
        <Banknote className="h-4 w-4 text-muted-foreground" />
        Certificates &amp; payments
      </Legend>
      <CardContent className="pt-5">
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
    <Card className="relative">
      <Legend>
        <HardHat className="h-4 w-4 text-muted-foreground" />
        Resources · this week
      </Legend>
      <CardContent className="space-y-1.5 pt-5 text-sm">
        <MoneyRow label="Total Headcount" text={num(r.labour_direct + r.labour_casual)} />
        <MoneyRow label="Total Casual Headcount" text={num(r.labour_casual)} />
        <MoneyRow label="Diesel Used This Week (L)" text={num(r.diesel_litres_week)} />
        <MoneyRow label="Diesel Cost This Week" v={r.diesel_cost_week}
          note="Cost Report AGO row — the money truth" />
      </CardContent>
    </Card>
  )
}

/* ── Cost & profitability ────────────────────────────────────────────── */


function CostProfitabilityCard({ o, unit, onUnit }: {
  o: ProjectOverview; unit: MoneyUnit; onUnit: (v: MoneyUnit) => void
}) {
  const cp = o.cost_profitability
  const fm = tableMoney(unit)
  const ul = unitLabel(unit)

  const donutOption = useMemo(() => ({
    tooltip: {
      trigger: 'item' as const,
      valueFormatter: (v: number) => `₦${fm(v)}m`,
    },
    legend: {
      orient: 'vertical' as const, right: '8%', top: 'middle',
      textStyle: { fontSize: 11 }, itemWidth: 10, itemHeight: 10,
      formatter: (name: string) => {
        const cat = cp.categories.find((c) => c.category === name)
        return cat?.pct_of_total != null
          ? `${name}  ${(cat.pct_of_total * 100).toFixed(1)}%`
          : name
      },
    },
    title: {
      text: naira(cp.total_to_date, true),
      subtext: 'cost to date',
      left: '49.5%', top: '40%', textAlign: 'center' as const,
      textStyle: { fontSize: 15, fontWeight: 700 as const },
      subtextStyle: { fontSize: 10 },
    },
    series: [{
      type: 'pie' as const, radius: ['58%', '80%'], center: ['50%', '50%'],
      itemStyle: { borderWidth: 2, borderColor: 'transparent', borderRadius: 3 },
      label: { show: false },
      data: cp.categories.map((c, i) => ({
        name: c.category, value: Math.round(c.to_date),
        itemStyle: { color: categoryColor(c.category, i) },
      })),
    }],
  }), [cp])

  return (
    <Card className="relative">
      <Legend>Cost &amp; profitability</Legend>
      <UnitToggle unit={unit} onUnit={onUnit} />
      <CardContent className="p-0 pt-4">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[560px] text-sm">
            <thead>
              <tr className="border-b bg-primary text-primary-foreground text-left text-[11px] uppercase tracking-wide">
                <th className="whitespace-nowrap px-4 py-2 font-bold">Cost Category</th>
                <th className="whitespace-nowrap px-4 py-2 text-right font-bold">Last Wk ({ul})</th>
                <th className="whitespace-nowrap px-4 py-2 text-right font-bold">This Wk ({ul})</th>
                <th className="whitespace-nowrap px-4 py-2 text-right font-bold">To Date ({ul})</th>
                <th className="whitespace-nowrap px-4 py-2 text-right font-bold">% of Total</th>
              </tr>
            </thead>
            <tbody>
              {cp.categories.map((c, i) => (
                <tr key={c.category} className={`border-b ${i % 2 ? 'bg-muted/20' : ''}`}>
                  <td className="px-4 py-1.5">
                    <span className="mr-2 inline-block h-2.5 w-2.5 rounded-full align-middle"
                      style={{ backgroundColor: categoryColor(c.category, i) }} />
                    {c.category}
                  </td>
                  <td className="px-4 py-1.5 text-right tabular-nums text-muted-foreground">{fm(c.last_week)}</td>
                  <td className="px-4 py-1.5 text-right tabular-nums">{fm(c.this_week)}</td>
                  <td className="px-4 py-1.5 text-right tabular-nums">{fm(c.to_date)}</td>
                  <td className="px-4 py-1.5 text-right tabular-nums">{pctFmt(c.pct_of_total)}</td>
                </tr>
              ))}
              <tr className="border-b bg-muted/40 font-semibold">
                <td className="px-4 py-2">Total Costs to Date</td>
                <td className="px-4 py-2 text-right tabular-nums text-muted-foreground">{fm(cp.total_last_week)}</td>
                <td className="px-4 py-2 text-right tabular-nums">{fm(cp.total_this_week)}</td>
                <td className="px-4 py-2 text-right tabular-nums">{fm(cp.total_to_date)}</td>
                <td className="px-4 py-2 text-right tabular-nums">100.0%</td>
              </tr>
              <tr className="border-b">
                <td className="px-4 py-2">Value of Work Done — Incl. VAT, Excl. Contingency</td>
                <td className="px-4 py-2 text-right tabular-nums text-muted-foreground">{fm(cp.works_incl_vat_last_week)}</td>
                <td className="px-4 py-2 text-right tabular-nums">{fm(cp.works_incl_vat_this_week)}</td>
                <td className="px-4 py-2 text-right tabular-nums">{fm(cp.works_incl_vat_to_date)}</td>
                <td className="px-4 py-2" />
              </tr>
              <tr className="border-b bg-emerald-500/5 font-semibold">
                <td className="px-4 py-2">Net Earnings</td>
                <td className={`px-4 py-2 text-right tabular-nums ${cp.net_last_week != null && cp.net_last_week < 0 ? 'text-red-600' : 'text-muted-foreground'}`}>
                  {fm(cp.net_last_week)}
                </td>
                <td className={`px-4 py-2 text-right tabular-nums ${cp.net_this_week < 0 ? 'text-red-600' : 'text-emerald-700 dark:text-emerald-400'}`}>
                  {fm(cp.net_this_week)}
                </td>
                <td className={`px-4 py-2 text-right tabular-nums ${cp.net_to_date < 0 ? 'text-red-600' : 'text-emerald-700 dark:text-emerald-400'}`}>
                  {fm(cp.net_to_date)}
                </td>
                <td className="px-4 py-2" />
              </tr>
              <tr className="bg-emerald-500/5 font-bold">
                <td className="px-4 py-2">Net Margin %</td>
                <td className="px-4 py-2 text-right tabular-nums text-muted-foreground">{pctFmt(cp.margin_last_week)}</td>
                <td className={`px-4 py-2 text-right tabular-nums ${cp.margin_this_week != null && cp.margin_this_week < 0 ? 'text-red-600' : ''}`}>
                  {pctFmt(cp.margin_this_week)}
                </td>
                <td className={`px-4 py-2 text-right tabular-nums ${cp.margin_to_date != null && cp.margin_to_date < 0 ? 'text-red-600' : ''}`}>
                  {pctFmt(cp.margin_to_date)}
                </td>
                <td className="px-4 py-2" />
              </tr>
            </tbody>
          </table>
        </div>
        <div className="px-4 pb-4 pt-5">
          <p className="mb-2 text-xs font-bold uppercase tracking-wide">Cost to Date by Category</p>
          <ECharts option={donutOption} style={{ height: 260 }} notMerge />
        </div>
      </CardContent>
    </Card>
  )
}

/* ── shared bits ─────────────────────────────────────────────────────── */




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
      <Skeleton className="h-44" />
      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-4">
        {Array.from({ length: 8 }).map((_, i) => <Skeleton key={i} className="h-24" />)}
      </div>
      <Skeleton className="h-56" />
      <Skeleton className="h-96" />
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
