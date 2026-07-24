'use client'

/**
 * Financials — the client-money page: certificate ledger (verbatim,
 * the workbook's own columns), latest payments ledger, retention and
 * advance positions — plus the cash story: cumulative payments over
 * time against the certified level, and a FIFO breakdown of what's
 * certified but not yet paid. The workbook's certificate ledger never
 * carries dates, so per-certificate payment lag is deliberately NOT
 * computed — the dated side of the story lives entirely on payments.
 */

import { useMemo } from 'react'
import { useParams } from 'next/navigation'
import ECharts from 'echarts-for-react'
import { Card, CardContent } from '@/components/ui/card'
import { Kpi, Legend } from '@/components/projects/hub-ui'
import { Skeleton } from '@/components/ui/skeleton'
import { useProjectLedgers, useProjectOverview } from '@/hooks/use-projects'
import { naira, num, fmtDate } from '@/lib/format'

const n = (v: unknown): number | null => (v == null ? null : Number(v))

const compactNaira = (v: number) =>
  Math.abs(v) >= 1_000_000_000 ? `₦${(v / 1_000_000_000).toFixed(1)}B`
    : Math.abs(v) >= 1_000_000 ? `₦${(v / 1_000_000).toFixed(0)}m`
    : Math.abs(v) >= 1_000 ? `₦${(v / 1_000).toFixed(0)}k` : `₦${v}`

export default function FinancialsPage() {
  const params = useParams<{ id: string }>()
  const { data: ledgers, isLoading } = useProjectLedgers(params.id)
  const { data: o } = useProjectOverview(params.id)

  const certs = ledgers?.certificates ?? []
  const payments = ledgers?.payments ?? []
  const certified = o?.certs_payments.certified_to_date ?? null

  // cumulative cert-type payments over time — the cash staircase
  const cashCurve = useMemo(() => {
    const dated = payments
      .filter((p) => String(p.payment_type ?? '').toLowerCase().includes('cert') && p.payment_date)
      .map((p) => ({ date: String(p.payment_date), gross: Number(p.gross_amount ?? 0) }))
      .sort((a, b) => a.date.localeCompare(b.date))
    let cum = 0
    const points = dated.map((p) => {
      cum += p.gross
      return [p.date, Math.round(cum)] as [string, number]
    })
    const last = dated.length ? dated[dated.length - 1] : null
    const daysSince = last
      ? Math.floor((Date.now() - new Date(last.date + 'T00:00:00').getTime()) / 86_400_000)
      : null
    return { points, last, daysSince }
  }, [payments])

  // FIFO: cert-type money applied to certificates oldest-first — which
  // certificates make up the certified-not-paid position
  const unpaid = useMemo(() => {
    const rows = certs
      .map((c) => ({ cert: String(c.cert_number), cum: n(c.gross_value_works_done) }))
      .filter((c): c is { cert: string; cum: number } => c.cum != null)
      .sort((a, b) => a.cum - b.cum)
    const certPaid = payments
      .filter((p) => String(p.payment_type ?? '').toLowerCase().includes('cert'))
      .reduce((a, p) => a + Number(p.gross_amount ?? 0), 0)
    let prevCum = 0
    const out = rows.map((r) => {
      const increment = Math.max(0, r.cum - prevCum)
      const covered = Math.min(Math.max(0, certPaid - prevCum), increment)
      prevCum = r.cum
      return { ...r, increment, covered, outstanding: increment - covered }
    })
    return out.filter((r) => r.outstanding > 0.5)
  }, [certs, payments])

  if (isLoading) return <PageSkeleton />

  if (certs.length === 0 && payments.length === 0) {
    return (
      <div className="rounded-lg border py-12 text-center text-muted-foreground">
        <p className="text-lg font-medium text-foreground">Young ledger</p>
        <p className="mt-1 text-sm">
          No certificates or payments recorded in this project&apos;s workbook yet —
          the page fills itself as the site&apos;s commercial history builds.
        </p>
      </div>
    )
  }

  const curveOption = {
    tooltip: {
      trigger: 'axis',
      valueFormatter: (v: number) => naira(v),
    },
    grid: { left: 64, right: 24, top: 28, bottom: 32 },
    xAxis: { type: 'time' },
    yAxis: { type: 'value', axisLabel: { formatter: compactNaira } },
    series: [{
      name: 'Paid on certificates · cumulative',
      type: 'line',
      step: 'end',
      data: cashCurve.points,
      itemStyle: { color: '#10b981' },
      lineStyle: { width: 2.5 },
      areaStyle: { opacity: 0.08 },
      ...(certified != null
        ? {
            markLine: {
              silent: true,
              symbol: 'none',
              lineStyle: { color: '#f59e0b', type: 'dashed', width: 2 },
              label: { formatter: `Certified to date ${compactNaira(certified)}`, position: 'insideEndTop' },
              data: [{ yAxis: Math.round(certified) }],
            },
          }
        : {}),
    }],
  }

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
        <Kpi label="Certified · cumulative" value={naira(certified, true)}
          sub={`${certs.length} certificates`} />
        <Kpi label="Paid · gross" value={naira(o?.certs_payments.payments_gross ?? null, true)}
          sub={cashCurve.last
            ? `${payments.length} payments · last ${fmtDate(cashCurve.last.date)}`
            : `${payments.length} payments`} />
        <Kpi label="Certified, not yet paid" value={naira(o?.certs_payments.certified_not_paid ?? null, true)}
          sub={unpaid.length > 0
            ? `across cert${unpaid.length > 1 ? 's' : ''} ${unpaid.map((u) => u.cert).join(', ')}`
            : undefined} />
        <Kpi label="Retention held" value={naira(o?.certs_payments.retention_held ?? null, true)}
          sub={`released ${naira(o?.certs_payments.retention_released ?? null, true)}`} />
      </div>

      {cashCurve.points.length > 1 && (
        <Card className="relative">
          <Legend>Client payments · cumulative</Legend>
          <CardContent className="space-y-3 pt-3">
            {cashCurve.last && (
              <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1 px-1">
                <span className="text-xs font-medium uppercase text-muted-foreground">
                  Last payment
                </span>
                <span className="text-xl font-bold tabular-nums">{fmtDate(cashCurve.last.date)}</span>
                <span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${
                  (cashCurve.daysSince ?? 0) > 90
                    ? 'bg-red-500/10 text-red-600'
                    : (cashCurve.daysSince ?? 0) > 45
                      ? 'bg-amber-500/15 text-amber-800 dark:text-amber-300'
                      : 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-400'
                }`}>
                  {num(cashCurve.daysSince ?? 0)} days ago
                </span>
              </div>
            )}
            <ECharts option={curveOption} style={{ height: 300 }} notMerge />
          </CardContent>
        </Card>
      )}

      {unpaid.length > 0 && (
        <Card className="relative">
          <Legend>Certified, not yet paid · by certificate</Legend>
          <CardContent className="p-0 pt-2">
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b bg-primary text-primary-foreground text-left">
                    <th className="px-4 py-2 font-bold">Cert</th>
                    <th className="px-4 py-2 text-right font-bold">Certified to Date</th>
                    <th className="px-4 py-2 text-right font-bold">This Certificate</th>
                    <th className="px-4 py-2 text-right font-bold">Paid Against It</th>
                    <th className="px-4 py-2 text-right font-bold">Outstanding</th>
                  </tr>
                </thead>
                <tbody>
                  {unpaid.map((u) => (
                    <tr key={u.cert} className="border-b last:border-0">
                      <td className="px-4 py-1.5 font-medium tabular-nums">{u.cert}</td>
                      <td className="px-4 py-1.5 text-right tabular-nums">{naira(u.cum)}</td>
                      <td className="px-4 py-1.5 text-right tabular-nums">{naira(u.increment)}</td>
                      <td className="px-4 py-1.5 text-right tabular-nums">{naira(u.covered)}</td>
                      <td className="px-4 py-1.5 text-right tabular-nums font-semibold text-red-600">
                        {naira(u.outstanding)}
                      </td>
                    </tr>
                  ))}
                  <tr className="bg-muted/40 font-semibold">
                    <td className="px-4 py-2" colSpan={4}>Total outstanding</td>
                    <td className="px-4 py-2 text-right tabular-nums text-red-600">
                      {naira(unpaid.reduce((a, u) => a + u.outstanding, 0))}
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
            <p className="border-t px-4 py-2 text-xs text-muted-foreground">
              Payments applied to certificates oldest-first
            </p>
          </CardContent>
        </Card>
      )}

      {certs.length > 0 && (
        <Card className="relative">
          <Legend>Certificate ledger</Legend>
          <CardContent className="p-0 pt-3">
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b bg-primary text-primary-foreground text-left">
                    <th className="px-3 py-2 font-bold">Cert</th>
                    <th className="px-3 py-2 font-bold">Date Submitted</th>
                    <th className="px-3 py-2 text-right font-bold">Gross Value of Works Done</th>
                    <th className="px-3 py-2 text-right font-bold">Add Materials on Site</th>
                    <th className="px-3 py-2 text-right font-bold">General Bill 1</th>
                    <th className="px-3 py-2 text-right font-bold">Total Value of Work Done</th>
                    <th className="px-3 py-2 text-right font-bold">Total Retention Held</th>
                    <th className="px-3 py-2 text-right font-bold">Total Net Payment</th>
                    <th className="px-3 py-2 text-right font-bold">Advance Received</th>
                    <th className="px-3 py-2 text-right font-bold">Total Works Executed</th>
                    <th className="px-3 py-2 text-right font-bold">New Total</th>
                  </tr>
                </thead>
                <tbody>
                  {certs.map((c, i) => (
                    <tr key={String(c.cert_number)} className={`border-b last:border-0 ${i % 2 ? 'bg-muted/20' : ''}`}>
                      <td className="px-3 py-1.5 font-medium tabular-nums">{String(c.cert_number)}</td>
                      <td className="px-3 py-1.5 text-muted-foreground">{fmtDate(c.date_submitted as string | null)}</td>
                      <td className="px-3 py-1.5 text-right tabular-nums">{naira(n(c.gross_value_works_done))}</td>
                      <td className="px-3 py-1.5 text-right tabular-nums">{naira(n(c.add_materials_on_site))}</td>
                      <td className="px-3 py-1.5 text-right tabular-nums">{naira(n(c.general_bill_1))}</td>
                      <td className="px-3 py-1.5 text-right tabular-nums">{naira(n(c.total_value_of_work_done))}</td>
                      <td className="px-3 py-1.5 text-right tabular-nums">{naira(n(c.total_retention_held))}</td>
                      <td className="px-3 py-1.5 text-right tabular-nums">{naira(n(c.total_net_payment))}</td>
                      <td className="px-3 py-1.5 text-right tabular-nums">{naira(n(c.advance_received))}</td>
                      <td className="px-3 py-1.5 text-right tabular-nums">{naira(n(c.total_works_executed))}</td>
                      <td className="px-3 py-1.5 text-right tabular-nums">{naira(n(c.new_total))}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      )}

      {payments.length > 0 && (
        <Card className="relative">
          <Legend>Payments · latest ledger</Legend>
          <CardContent className="p-0 pt-3">
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b bg-primary text-primary-foreground text-left">
                    <th className="px-3 py-2 font-bold">Date</th>
                    <th className="px-3 py-2 font-bold">Voucher Number</th>
                    <th className="px-3 py-2 font-bold">Payment Type</th>
                    <th className="px-3 py-2 text-right font-bold">Gross Amount (Incl. VAT)</th>
                    <th className="px-3 py-2 text-right font-bold">WHT</th>
                    <th className="px-3 py-2 text-right font-bold">VAT</th>
                    <th className="px-3 py-2 text-right font-bold">Vetting Fee</th>
                    <th className="px-3 py-2 text-right font-bold">Stamp Duty</th>
                    <th className="px-3 py-2 text-right font-bold">Net Amount Payable</th>
                  </tr>
                </thead>
                <tbody>
                  {payments.map((p, i) => (
                    <tr key={i} className={`border-b last:border-0 ${i % 2 ? 'bg-muted/20' : ''}`}>
                      <td className="px-3 py-1.5 text-muted-foreground">{fmtDate(p.payment_date as string | null)}</td>
                      <td className="px-3 py-1.5">{String(p.voucher_number ?? '—')}</td>
                      <td className="px-3 py-1.5">{String(p.payment_type ?? '—')}</td>
                      <td className="px-3 py-1.5 text-right tabular-nums font-medium">{naira(n(p.gross_amount))}</td>
                      <td className="px-3 py-1.5 text-right tabular-nums">{naira(n(p.wht))}</td>
                      <td className="px-3 py-1.5 text-right tabular-nums">{naira(n(p.vat))}</td>
                      <td className="px-3 py-1.5 text-right tabular-nums">{naira(n(p.vetting_fee))}</td>
                      <td className="px-3 py-1.5 text-right tabular-nums">{naira(n(p.stamp_duty))}</td>
                      <td className="px-3 py-1.5 text-right tabular-nums">{naira(n(p.net_amount))}</td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr className="border-t bg-muted/40 font-semibold">
                    <td className="px-3 py-2" colSpan={3}>Total All</td>
                    <td className="px-3 py-2 text-right tabular-nums">
                      {naira(payments.reduce((a, p) => a + Number(p.gross_amount ?? 0), 0))}
                    </td>
                    <td colSpan={4} />
                    <td className="px-3 py-2 text-right tabular-nums">
                      {naira(payments.reduce((a, p) => a + Number(p.net_amount ?? 0), 0))}
                    </td>
                  </tr>
                </tfoot>
              </table>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  )
}


function PageSkeleton() {
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
        {[...Array(4)].map((_, i) => <Skeleton key={i} className="h-24" />)}
      </div>
      <Skeleton className="h-80" />
      <Skeleton className="h-80" />
    </div>
  )
}
