'use client'

/**
 * Financials — the client-money page: certificate ledger (verbatim,
 * the workbook's own columns), latest payments ledger, retention and
 * advance positions. Never the Contract Summary's fossil client block.
 */

import { useParams } from 'next/navigation'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { useProjectLedgers, useProjectOverview } from '@/hooks/use-projects'
import { naira, fmtDate } from '@/lib/format'

const n = (v: unknown): number | null => (v == null ? null : Number(v))

export default function FinancialsPage() {
  const params = useParams<{ id: string }>()
  const { data: ledgers, isLoading } = useProjectLedgers(params.id)
  const { data: o } = useProjectOverview(params.id)

  if (isLoading) return <PageSkeleton />

  const certs = ledgers?.certificates ?? []
  const payments = ledgers?.payments ?? []

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

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
        <Kpi label="Certified · cumulative" value={naira(o?.certs_payments.certified_to_date ?? null, true)}
          sub={`${certs.length} certificates`} lineage="cert ledger cumulative, as recorded" />
        <Kpi label="Paid · gross" value={naira(o?.certs_payments.payments_gross ?? null, true)}
          sub={`${payments.length} payments`} lineage="latest ledger, incl VAT" />
        <Kpi label="Certified, not yet paid" value={naira(o?.certs_payments.certified_not_paid ?? null, true)}
          lineage="certified − cert-type payments" />
        <Kpi label="Retention held" value={naira(o?.certs_payments.retention_held ?? null, true)}
          sub={`released ${naira(o?.certs_payments.retention_released ?? null, true)}`}
          lineage="5% of cumulative gross" />
      </div>

      {certs.length > 0 && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">Certificate ledger</CardTitle>
            <p className="text-xs text-muted-foreground">
              cumulative per certificate, workbook columns verbatim · scroll for the full 19
            </p>
          </CardHeader>
          <CardContent className="p-0">
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b bg-muted/40 text-left text-muted-foreground">
                    <th className="px-3 py-2 font-medium">Cert</th>
                    <th className="px-3 py-2 font-medium">Date Submitted</th>
                    <th className="px-3 py-2 text-right font-medium">Gross Value of Works Done</th>
                    <th className="px-3 py-2 text-right font-medium">Add Materials on Site</th>
                    <th className="px-3 py-2 text-right font-medium">General Bill 1</th>
                    <th className="px-3 py-2 text-right font-medium">Total Value of Work Done</th>
                    <th className="px-3 py-2 text-right font-medium">Total Retention Held</th>
                    <th className="px-3 py-2 text-right font-medium">Total Net Payment</th>
                    <th className="px-3 py-2 text-right font-medium">Advance Received</th>
                    <th className="px-3 py-2 text-right font-medium">Total Works Executed</th>
                    <th className="px-3 py-2 text-right font-medium">New Total</th>
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
            <p className="border-t px-3 py-2 text-[11px] text-muted-foreground">
              Certificates are cumulative — the last row carries the position to date. Retention
              cross-checked at 5% of cumulative gross on every upload.
            </p>
          </CardContent>
        </Card>
      )}

      {payments.length > 0 && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">Payments · latest ledger</CardTitle>
            <p className="text-xs text-muted-foreground">
              the latest workbook re-states the full history — earlier copies are never summed
            </p>
          </CardHeader>
          <CardContent className="p-0">
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b bg-muted/40 text-left text-muted-foreground">
                    <th className="px-3 py-2 font-medium">Date</th>
                    <th className="px-3 py-2 font-medium">Voucher Number</th>
                    <th className="px-3 py-2 font-medium">Payment Type</th>
                    <th className="px-3 py-2 text-right font-medium">Gross Amount (Incl. VAT)</th>
                    <th className="px-3 py-2 text-right font-medium">WHT</th>
                    <th className="px-3 py-2 text-right font-medium">VAT</th>
                    <th className="px-3 py-2 text-right font-medium">Vetting Fee</th>
                    <th className="px-3 py-2 text-right font-medium">Stamp Duty</th>
                    <th className="px-3 py-2 text-right font-medium">Net Amount Payable</th>
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
            <p className="border-t px-3 py-2 text-[11px] text-muted-foreground">
              net = gross − (WHT + VAT + vetting + stamp duty + other) · rows cross-checked
              against the sheet&apos;s own Total All on upload
            </p>
          </CardContent>
        </Card>
      )}
    </div>
  )
}

function Kpi({ label, value, sub, lineage }: { label: string; value: string; sub?: string; lineage: string }) {
  return (
    <Card className="py-0">
      <CardContent className="px-4 py-3">
        <p className="text-[11px] text-muted-foreground">{label}</p>
        <p className="mt-0.5 text-xl font-bold tabular-nums">{value}</p>
        {sub && <p className="truncate text-[11px] text-muted-foreground">{sub}</p>}
        <p className="text-[10px] text-muted-foreground/70">{lineage}</p>
      </CardContent>
    </Card>
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
