'use client'

/**
 * Overview — the living Contract Summary. Every figure computed from
 * ledgers and atomic weekly facts (docs/WORKBOOK_ARITHMETIC.md); each
 * card shows its working, the way the workbook shows its ladders.
 */

import Link from 'next/link'
import { useParams } from 'next/navigation'
import {
  AlertTriangle, CalendarDays, FileSpreadsheet, Wallet, HardHat, Percent,
} from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { useProjectOverview } from '@/hooks/use-projects'
import type { ProjectOverview } from '@/lib/api/projects'

const naira = (v: number | null | undefined, compact = false): string => {
  if (v == null) return '—'
  if (compact) {
    const abs = Math.abs(v)
    if (abs >= 1e9) return `₦${(v / 1e9).toFixed(2)}B`
    if (abs >= 1e6) return `₦${(v / 1e6).toFixed(1)}M`
  }
  return new Intl.NumberFormat('en-NG', {
    style: 'currency', currency: 'NGN', maximumFractionDigits: 0,
  }).format(v)
}
const pct = (v: number | null | undefined): string =>
  v == null ? '—' : `${(v * 100).toFixed(1)}%`
const fmtDate = (d: string | null | undefined): string =>
  d ? new Date(d + (d.length === 10 ? 'T00:00:00' : '')).toLocaleDateString('en-GB', {
    day: '2-digit', month: 'short', year: 'numeric',
  }) : '—'

export default function ProjectOverviewPage() {
  const params = useParams<{ id: string }>()
  const { data: o, isLoading } = useProjectOverview(params.id)

  if (isLoading || !o) return <OverviewSkeleton />
  if (!o.latest_week) return <NoReportsYet />

  const L = o.ladder
  const young = o.certificates.count === 0 && o.payment_status.count === 0

  return (
    <div className="space-y-4">
      {/* Headline KPIs */}
      <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
        <Kpi
          icon={HardHat} label="Work done · to date"
          value={naira(L.works_to_date, true)} sub={naira(L.works_to_date)}
          lineage="BEME works, excl VAT"
        />
        <Kpi
          icon={FileSpreadsheet} label="Certified · ledger"
          value={o.certificates.count ? naira(L.certified_ex_vat, true) : 'None yet'}
          sub={o.certificates.count ? `${o.certificates.count} certs · ${naira(L.certified_ex_vat)}` : 'no certificates recorded'}
          lineage="cumulative gross, excl VAT"
        />
        <Kpi
          icon={Wallet} label="Paid · latest ledger"
          value={o.payment_status.count ? naira(L.paid_gross, true) : 'None yet'}
          sub={o.payment_status.count ? `${o.payment_status.count} payments · ${naira(L.paid_gross)}` : 'no payments recorded'}
          lineage="gross incl VAT"
        />
        <Kpi
          icon={Percent} label="Physical progress"
          value={pct(o.progress.physical_pct)}
          sub={`workbook reports ${pct(o.progress.reported_pct)}`}
          lineage="works ÷ BEME scope"
        />
      </div>

      <Alerts o={o} />

      {/* Money ladder */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">Money ladder</CardTitle>
          <p className="text-xs text-muted-foreground">
            Every line shows its working — sources per WORKBOOK_ARITHMETIC.md
          </p>
        </CardHeader>
        <CardContent className="p-0">
          <div className="divide-y text-sm">
            <Rung label="Contract sum" value={L.contract_sum} note="register · Contract Summary" />
            <Rung label="BEME scope" value={L.beme_scope}
              note={`Σ item contract amounts${o.alerts.scope_exceeds_contract ? ' · exceeds contract — variation pending' : ''}`}
              warn={o.alerts.scope_exceeds_contract} />
            <Rung label="Work done to date" value={L.works_to_date} note="previous + stored weeks (kobo-exact vs workbook)" />
            <Rung label="Earnings (works + VAT 7.5%)" value={L.earnings_to_date} note="excl contingency · Weekly Summary convention" />
            <Rung label="Certified (incl VAT)" value={young ? null : L.certified_incl_vat}
              note={young ? 'no certificates recorded yet' : 'cert ledger gross × 1.075'} />
            <Rung label="Paid to date" value={young ? null : L.paid_gross}
              note={young ? 'no payments recorded yet' : "payments ledger 'Total All' · gross incl VAT"} />
            <Rung label="Work in progress (uncertified)" value={young ? null : L.wip_incl_vat}
              note="earnings − certified" bold />
            <Rung label="Certified, not yet paid" value={young ? null : L.certified_not_paid}
              note="certified incl VAT − paid" bold />
          </div>
        </CardContent>
      </Card>

      <div className="grid gap-3 lg:grid-cols-3">
        {/* Net earnings */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">Net earnings · to date</CardTitle>
          </CardHeader>
          <CardContent className="space-y-1">
            <p className="text-2xl font-bold tabular-nums">
              {naira(o.net_earnings.value, true)}
              {o.net_earnings.pct != null && (
                <span className={`ml-2 text-sm font-medium ${o.net_earnings.value >= 0 ? 'text-emerald-600' : 'text-red-600'}`}>
                  {pct(o.net_earnings.pct)}
                </span>
              )}
            </p>
            <p className="text-xs text-muted-foreground tabular-nums">
              earnings {naira(o.net_earnings.earnings, true)} − costs {naira(o.net_earnings.costs_to_date, true)}
            </p>
            <p className="text-[11px] text-muted-foreground">
              Weekly Summary definition · excl contingency
            </p>
          </CardContent>
        </Card>

        {/* Payment status */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">Payment status · latest ledger</CardTitle>
          </CardHeader>
          <CardContent className="space-y-1.5 text-sm">
            {young ? (
              <p className="text-muted-foreground text-xs py-2">
                No payments recorded yet — young ledger.
              </p>
            ) : (
              <>
                <MoneyRow label="Advances" v={o.payment_status.advances} />
                <MoneyRow label="Certificates paid" v={o.payment_status.certs_paid} />
                {Math.abs(o.payment_status.on_account) > 0.5 && (
                  <MoneyRow label="On account / other" v={o.payment_status.on_account} />
                )}
                <div className="border-t pt-1.5">
                  <MoneyRow label="Total gross" v={o.payment_status.total_gross} bold />
                  <MoneyRow label="Total net (after deductions)" v={o.payment_status.total_net} />
                </div>
              </>
            )}
          </CardContent>
        </Card>

        {/* Retention & certificates */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">Certificates &amp; retention</CardTitle>
          </CardHeader>
          <CardContent className="space-y-1.5 text-sm">
            {young ? (
              <p className="text-muted-foreground text-xs py-2">
                No certificates recorded yet — young ledger.
              </p>
            ) : (
              <>
                <MoneyRow label={`Certified (${o.certificates.count} certs)`} v={o.certificates.cumulative_gross} />
                <MoneyRow label="Retention held (5%)" v={o.certificates.retention_held} />
                <MoneyRow label="Retention released" v={o.certificates.retention_released} />
                <MoneyRow label="Advance recovered" v={o.certificates.advance_recovery} />
              </>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Latest week + recent weeks */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm">
            Recent weeks
            <span className="text-muted-foreground ml-2 font-normal text-xs">
              latest: W{String(o.latest_week.week_number).padStart(2, '0')} · w/e {fmtDate(o.latest_week.week_ending_date)}
            </span>
          </CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b text-left text-xs text-muted-foreground">
                  <th className="px-4 py-2 font-medium">Week</th>
                  <th className="px-4 py-2 font-medium">Ending</th>
                  <th className="px-4 py-2 text-right font-medium">Works this week</th>
                  <th className="px-4 py-2 text-right font-medium">Cost this week</th>
                  <th className="px-4 py-2 text-right font-medium">Flags</th>
                </tr>
              </thead>
              <tbody>
                {o.recent_weeks.map((w) => (
                  <tr key={`${w.year}-${w.week_number}`} className="border-b last:border-0">
                    <td className="px-4 py-2 tabular-nums">{w.year} · W{String(w.week_number).padStart(2, '0')}</td>
                    <td className="px-4 py-2 text-muted-foreground">{fmtDate(w.week_ending_date)}</td>
                    <td className="px-4 py-2 text-right tabular-nums">{naira(w.works_this_week)}</td>
                    <td className="px-4 py-2 text-right tabular-nums">{naira(w.cost_this_week)}</td>
                    <td className="px-4 py-2 text-right">
                      {w.flags > 0 ? (
                        <span className="text-amber-700 text-xs">{w.flags}</span>
                      ) : (
                        <span className="text-muted-foreground text-xs">0</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="border-t px-4 py-2 text-xs text-muted-foreground">
            Full history, flags and original files on the{' '}
            <Link href={`/projects/${o.project.id}/submissions`} className="underline hover:text-foreground">
              Submissions tab
            </Link>.
          </p>
        </CardContent>
      </Card>

      {/* Contract details (register) */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm">Contract details · register</CardTitle>
        </CardHeader>
        <CardContent className="grid grid-cols-2 gap-x-6 gap-y-2 text-sm md:grid-cols-3">
          <Fact label="Client" value={o.project.client} />
          <Fact label="State" value={o.project.state_name ?? '—'} />
          <Fact label="Type" value={[o.project.project_type, o.project.work_nature].filter(Boolean).join(' · ') || '—'} />
          <Fact label="Original contract sum" value={naira(o.project.original_contract_sum)} />
          <Fact label="Current contract sum" value={naira(o.project.current_contract_sum)} />
          <Fact label="Award date" value={fmtDate(o.project.award_date)} />
          <Fact label="Commencement" value={fmtDate(o.project.commencement_date)} />
          <Fact label="Revised completion" value={fmtDate(o.project.revised_completion_date)} />
        </CardContent>
      </Card>
    </div>
  )
}

function Kpi({ icon: Icon, label, value, sub, lineage }: {
  icon: React.ElementType; label: string; value: string; sub?: string; lineage: string
}) {
  return (
    <Card className="py-0">
      <CardContent className="px-4 py-3">
        <p className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
          <Icon className="h-3.5 w-3.5" />
          {label}
        </p>
        <p className="mt-0.5 text-xl font-bold tabular-nums">{value}</p>
        {sub && <p className="text-[11px] text-muted-foreground tabular-nums truncate">{sub}</p>}
        <p className="text-[10px] text-muted-foreground/70">{lineage}</p>
      </CardContent>
    </Card>
  )
}

function Rung({ label, value, note, bold, warn }: {
  label: string; value: number | null; note: string; bold?: boolean; warn?: boolean
}) {
  return (
    <div className="flex flex-wrap items-baseline gap-x-4 px-4 py-2">
      <span className={`w-64 shrink-0 ${bold ? 'font-semibold' : 'text-muted-foreground'}`}>{label}</span>
      <span className={`tabular-nums ${bold ? 'font-semibold' : ''}`}>
        {value == null ? <span className="text-muted-foreground">—</span> : naira(value)}
      </span>
      <span className={`ml-auto text-[11px] ${warn ? 'text-amber-700' : 'text-muted-foreground/70'}`}>{note}</span>
    </div>
  )
}

function MoneyRow({ label, v, bold }: { label: string; v: number; bold?: boolean }) {
  return (
    <p className={`flex justify-between gap-2 ${bold ? 'font-semibold' : ''}`}>
      <span className={bold ? '' : 'text-muted-foreground'}>{label}</span>
      <span className="tabular-nums">{naira(v)}</span>
    </p>
  )
}

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-[11px] text-muted-foreground">{label}</p>
      <p className="truncate">{value}</p>
    </div>
  )
}

function Alerts({ o }: { o: ProjectOverview }) {
  const items: string[] = []
  if (o.alerts.scope_exceeds_contract) {
    items.push(`Scope ${naira(o.ladder.beme_scope, true)} exceeds contract ${naira(o.ladder.contract_sum, true)} — variation pending`)
  }
  if (o.alerts.missing_weeks.length > 0) {
    items.push(`Missing weeks: ${o.alerts.missing_weeks.map(([y, w]) => `${y}-W${String(w).padStart(2, '0')}`).join(', ')}`)
  }
  if (o.alerts.flags_latest_week > 0) {
    items.push(`${o.alerts.flags_latest_week} flags in the latest week`)
  }
  if (o.alerts.unresolved_fleet > 0) {
    items.push(`${o.alerts.unresolved_fleet} fleet numbers awaiting a verdict`)
  }
  if (items.length === 0) return null
  return (
    <div className="rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-900 dark:border-amber-700 dark:bg-amber-950 dark:text-amber-200">
      <p className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
        {items.map((t, i) => (
          <span key={i}>{t}{i < items.length - 1 ? ' · ' : ''}</span>
        ))}
      </p>
    </div>
  )
}

function NoReportsYet() {
  return (
    <div className="rounded-lg border py-12 text-center text-muted-foreground">
      <CalendarDays className="mx-auto mb-3 h-10 w-10 opacity-50" />
      <p className="text-lg font-medium text-foreground">No weekly reports yet</p>
      <p className="mt-1 text-sm">
        Upload this project&apos;s first weekly report and the overview builds itself.
      </p>
      <Link
        href="/projects/upload"
        className="mt-4 inline-block rounded-md border px-4 py-2 text-sm hover:bg-muted"
      >
        Upload a weekly report
      </Link>
    </div>
  )
}

function OverviewSkeleton() {
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
        {[...Array(4)].map((_, i) => (
          <Card key={i} className="py-0">
            <CardContent className="px-4 py-3 space-y-2">
              <Skeleton className="h-3 w-24" />
              <Skeleton className="h-6 w-20" />
              <Skeleton className="h-3 w-28" />
            </CardContent>
          </Card>
        ))}
      </div>
      <Skeleton className="h-64 w-full" />
      <div className="grid gap-3 lg:grid-cols-3">
        {[...Array(3)].map((_, i) => <Skeleton key={i} className="h-40" />)}
      </div>
    </div>
  )
}
