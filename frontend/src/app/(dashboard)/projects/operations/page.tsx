'use client'

/**
 * Site Operations — the general MD/GPM view: every project that has
 * weekly-report data, with recomputed headline numbers, drilling down
 * into the per-project Operations tab.
 */

import Link from 'next/link'
import { useRouter } from 'next/navigation'
import {
  Activity, AlertCircle, ArrowLeft, CalendarClock, Droplets, Timer, Truck, Wallet,
} from 'lucide-react'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { useProjectOperations, type ProjectOperationsRow } from '@/hooks/use-projects'

const ngn = (v: number | null | undefined) =>
  v == null
    ? '—'
    : new Intl.NumberFormat('en-NG', {
        style: 'currency', currency: 'NGN', notation: 'compact',
        maximumFractionDigits: 1,
      }).format(v)

const num = (v: number | null | undefined) =>
  v == null ? '—' : new Intl.NumberFormat('en-NG').format(Math.round(v))

function FreshnessBadge({ days }: { days: number | null }) {
  if (days == null) return null
  if (days <= 14) {
    return <Badge className="bg-emerald-100 text-emerald-800 hover:bg-emerald-100">up to date</Badge>
  }
  if (days <= 28) {
    return <Badge className="bg-amber-100 text-amber-800 hover:bg-amber-100">{days}d since report</Badge>
  }
  return <Badge className="bg-red-100 text-red-800 hover:bg-red-100">{days}d since report</Badge>
}

function Metric({ icon: Icon, label, value }: {
  icon: React.ComponentType<{ className?: string }>
  label: string
  value: string
}) {
  return (
    <div className="flex items-center gap-2">
      <Icon className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
      <div className="min-w-0">
        <p className="text-[11px] leading-tight text-muted-foreground">{label}</p>
        <p className="truncate text-sm font-semibold tabular-nums">{value}</p>
      </div>
    </div>
  )
}

function ProjectCard({ p }: { p: ProjectOperationsRow }) {
  const router = useRouter()
  const certifiedPct =
    p.works_certified != null && p.current_contract_amount
      ? (p.works_certified / p.current_contract_amount) * 100
      : null
  const availability =
    p.hours_worked + p.breakdown_hours > 0
      ? (p.hours_worked / (p.hours_worked + p.breakdown_hours)) * 100
      : null

  return (
    <Card
      className="cursor-pointer transition-shadow hover:shadow-md"
      onClick={() => router.push(`/projects/${p.id}?tab=operations`)}
    >
      <CardContent className="space-y-4 p-4">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div className="min-w-0">
            <h3 className="truncate font-semibold">{p.short_name || p.project_name}</h3>
            <p className="text-xs text-muted-foreground">
              {p.location_name ? `${p.location_name} · ` : ''}
              W{p.first_week}–W{p.last_week} {p.latest_year} · {p.weeks_received} weeks
            </p>
          </div>
          <FreshnessBadge days={p.days_since_last_report} />
        </div>

        {certifiedPct != null && (
          <div>
            <div className="mb-1 flex justify-between text-[11px] text-muted-foreground">
              <span>Certified {ngn(p.works_certified)} of {ngn(p.current_contract_amount)}</span>
              <span>{certifiedPct.toFixed(1)}%</span>
            </div>
            <div className="h-1.5 rounded-full bg-muted">
              <div
                className="h-1.5 rounded-full bg-primary"
                style={{ width: `${Math.min(100, certifiedPct)}%` }}
              />
            </div>
          </div>
        )}

        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          <Metric icon={Timer} label="Hours worked" value={`${num(p.hours_worked)} hrs`} />
          <Metric
            icon={Activity} label="Availability"
            value={availability != null ? `${availability.toFixed(1)}%` : '—'}
          />
          <Metric icon={Droplets} label="Diesel" value={`${num(p.diesel_litres)} L`} />
          <Metric icon={Truck} label="Plant cost" value={ngn(p.plant_cost_ngn)} />
          <Metric icon={Wallet} label="Payments" value={ngn(p.payments_net_ngn)} />
          <Metric
            icon={CalendarClock} label="% complete"
            value={p.beme_pct_complete != null ? `${Number(p.beme_pct_complete).toFixed(1)}%` : '—'}
          />
        </div>
      </CardContent>
    </Card>
  )
}

export default function ProjectOperationsPage() {
  const { data, isLoading, isError } = useProjectOperations()

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="icon" asChild>
            <Link href="/projects"><ArrowLeft className="h-4 w-4" /></Link>
          </Button>
          <div>
            <h1 className="text-2xl font-bold">Site Operations</h1>
            <p className="text-sm text-muted-foreground">
              Live view of every site reporting weekly — all figures recomputed
              from submitted reports
            </p>
          </div>
        </div>
        <Button asChild size="sm" variant="outline">
          <Link href="/projects/submissions">Weekly Reports</Link>
        </Button>
      </div>

      {isLoading && (
        <div className="grid gap-4 lg:grid-cols-2">
          {Array.from({ length: 2 }).map((_, i) => <Skeleton key={i} className="h-52" />)}
        </div>
      )}

      {isError && (
        <div className="flex items-center gap-2 rounded-lg border border-destructive/30 bg-destructive/5 p-4 text-sm text-destructive">
          <AlertCircle className="h-4 w-4" />
          Could not load operations — check the backend and try again.
        </div>
      )}

      {data && data.length === 0 && (
        <div className="rounded-lg border border-dashed p-10 text-center text-sm text-muted-foreground">
          No weekly reports ingested yet. Upload site reports under
          Projects → Weekly Reports and they will appear here.
        </div>
      )}

      {data && data.length > 0 && (
        <div className="grid gap-4 lg:grid-cols-2">
          {data.map((p) => <ProjectCard key={p.id} p={p} />)}
        </div>
      )}
    </div>
  )
}
