'use client'

/**
 * Ongoing projects grouped by state — the project manager's landing view
 * (design approved 2026-10-11). Each state carries its totals; each site is
 * a card with net earnings first. Sites that have never reported stay on
 * the page as muted cards, so the whole company is always visible.
 */

import { useRouter } from 'next/navigation'
import { Card, CardContent } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Skeleton } from '@/components/ui/skeleton'
import { STATUS_STYLES } from '@/components/projects/project-status'
import type { OngoingProject } from '@/lib/api/projects'
import { fmtDate, money } from '@/lib/format'
import { type Figures, type LensKey, EMPTY, addFigures, figuresFor, marginOf } from './lens'
import type { PortfolioWeek } from '@/lib/api/projects'

export interface SiteRow {
  project: OngoingProject
  figures: Figures
  pct_complete: number | null
  weeks_received: number
  latest_week_ending: string | null
}

export interface StateGroup {
  state: string
  sites: SiteRow[]
  totals: Figures
  contract: number
  reporting: number
}

export function groupByState(
  projects: OngoingProject[],
  series: PortfolioWeek[],
  lens: LensKey,
  asAt: string,
): StateGroup[] {
  const rows: SiteRow[] = projects.map((p) => {
    const mine = series.filter((w) => w.project_id === p.id)
    return {
      project: p,
      figures: figuresFor(series, p.id, lens, asAt),
      // physical progress (work ÷ bills) returns with phase B/C; until then no bar
      pct_complete: null,
      weeks_received: mine.length,
      latest_week_ending: mine.length ? mine.map((w) => w.week_ending_date).sort().slice(-1)[0] : null,
    }
  })
  const groups = new Map<string, SiteRow[]>()
  for (const r of rows) {
    const k = r.project.state_name || 'State not set'
    groups.set(k, [...(groups.get(k) ?? []), r])
  }
  const out: StateGroup[] = [...groups.entries()].map(([state, sites]) => ({
    state,
    sites: sites.sort((a, b) => b.figures.net - a.figures.net),
    totals: sites.reduce((acc, s) => addFigures(acc, s.figures), EMPTY),
    contract: sites.reduce((acc, s) => acc + (s.project.contract_sum ?? 0), 0),
    reporting: sites.filter((s) => s.figures.weeks > 0).length,
  }))
  // states with figures first, by net; then the silent ones by contract value
  return out.sort((a, b) =>
    (b.reporting > 0 ? 1 : 0) - (a.reporting > 0 ? 1 : 0) || b.totals.net - a.totals.net || b.contract - a.contract)
}

const pct = (x: number | null) => (x == null ? '—' : `${(x * 100).toFixed(1)}%`)

export function StateStrip({ groups }: { groups: StateGroup[] }) {
  return (
    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
      {groups.map((g) => (
        <button
          key={g.state}
          type="button"
          onClick={() => document.getElementById(`state-${slug(g.state)}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' })}
          className="rounded-lg border bg-card p-3 text-left transition-colors hover:border-primary/50"
        >
          <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
            {g.state} · {g.sites.length} site{g.sites.length !== 1 ? 's' : ''}
          </p>
          <p className={`mt-0.5 text-base font-bold tabular-nums ${g.reporting ? (g.totals.net < 0 ? 'text-red-600' : '') : 'text-muted-foreground'}`}>
            {g.reporting ? money(g.totals.net) : '—'}
          </p>
        </button>
      ))}
    </div>
  )
}

const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-')

export function StateSections({ groups, isLoading }: { groups: StateGroup[]; isLoading: boolean }) {
  if (isLoading) {
    return (
      <div className="space-y-6">
        {[0, 1].map((i) => (
          <div key={i} className="space-y-3">
            <Skeleton className="h-8 w-48" />
            <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
              {[0, 1, 2].map((j) => <Skeleton key={j} className="h-44" />)}
            </div>
          </div>
        ))}
      </div>
    )
  }
  if (!groups.length) {
    return <div className="rounded-lg border py-12 text-center text-muted-foreground">No ongoing projects on this date.</div>
  }
  return (
    <div className="space-y-8">
      {groups.map((g) => (
        <section key={g.state} id={`state-${slug(g.state)}`} className="scroll-mt-24">
          <div className="flex flex-wrap items-end justify-between gap-x-6 gap-y-2 border-b-2 border-foreground pb-2">
            <div>
              <h2 className="text-lg font-bold tracking-tight">{g.state}</h2>
              <p className="text-sm text-muted-foreground tabular-nums">
                {g.sites.length} site{g.sites.length !== 1 ? 's' : ''} · {g.reporting} reporting · contract {money(g.contract)}
              </p>
            </div>
            <dl className="flex flex-wrap gap-x-6 gap-y-1 text-sm tabular-nums">
              <Total label="Work done" value={g.reporting ? money(g.totals.works_incl_vat) : '—'} />
              <Total label="Cost" value={g.reporting ? money(g.totals.cost) : '—'} />
              <Total label="Net earnings" value={g.reporting ? money(g.totals.net) : '—'}
                tone={g.reporting ? (g.totals.net < 0 ? 'bad' : 'good') : undefined} />
              <Total label="Margin" value={g.reporting ? pct(marginOf(g.totals)) : '—'} />
            </dl>
          </div>
          <div className="mt-4 grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
            {g.sites.map((s) => <SiteCard key={s.project.id} row={s} />)}
          </div>
        </section>
      ))}
    </div>
  )
}

function Total({ label, value, tone }: { label: string; value: string; tone?: 'good' | 'bad' }) {
  return (
    <div>
      <dt className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">{label}</dt>
      <dd className={`font-semibold ${tone === 'bad' ? 'text-red-600' : tone === 'good' ? 'text-emerald-700 dark:text-emerald-400' : ''}`}>{value}</dd>
    </div>
  )
}

export function SiteCard({ row }: { row: SiteRow }) {
  const router = useRouter()
  const { project: p, figures: f } = row
  const has = f.weeks > 0
  const neverReported = row.weeks_received === 0
  const m = marginOf(f)
  const style = STATUS_STYLES[p.status] || STATUS_STYLES.active
  const go = () => router.push(`/projects/${p.id}`)
  return (
    <Card
      role="link"
      tabIndex={0}
      onClick={go}
      onKeyDown={(e) => e.key === 'Enter' && go()}
      className={`group cursor-pointer transition-all duration-200 hover:-translate-y-0.5 hover:border-primary/50 hover:shadow-lg focus-visible:ring-2 focus-visible:ring-ring ${
        neverReported ? 'border-dashed bg-transparent shadow-none' : ''}`}
    >
      <CardContent className="flex h-full flex-col gap-3 p-5">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <h3 className="font-semibold leading-tight line-clamp-2">{p.short_name || p.project_name}</h3>
            <p className="mt-0.5 truncate text-xs text-muted-foreground tabular-nums">{p.contract_sum != null ? money(p.contract_sum) : '—'}</p>
          </div>
          <Badge variant={neverReported ? 'outline' : style.variant} className={neverReported ? 'shrink-0 text-muted-foreground' : `shrink-0 ${style.className ?? ''}`}>
            {neverReported ? 'Awaiting first report' : style.label}
          </Badge>
        </div>

        <div>
          <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">Net earnings</p>
          <p className={`text-2xl font-bold tabular-nums leading-tight ${has ? (f.net < 0 ? 'text-red-600' : '') : 'text-base font-medium text-muted-foreground'}`}>
            {has ? money(f.net) : '—'}
          </p>
        </div>

        {has && (
          <dl className="grid grid-cols-[1fr_auto] gap-x-3 gap-y-1 text-xs text-muted-foreground tabular-nums">
            <dt>Work done · incl. VAT</dt><dd className="text-right font-medium text-foreground">{money(f.works_incl_vat)}</dd>
            <dt>Cost</dt><dd className="text-right font-medium text-foreground">{money(f.cost)}</dd>
            <dt>Margin</dt>
            <dd className="text-right">
              <span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${
                m == null ? '' : m >= 0.3 ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-300'
                : m >= 0 ? 'bg-muted text-foreground' : 'bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-300'}`}>{pct(m)}</span>
            </dd>
            <dt>Weeks counted</dt><dd className="text-right font-medium text-foreground">{f.weeks}</dd>
          </dl>
        )}

        <div className="mt-auto flex items-center justify-between gap-3 border-t pt-2 text-[11px] text-muted-foreground tabular-nums">
          {row.pct_complete != null && !neverReported ? (
            <>
              <span>{pct(row.pct_complete)} of bills done</span>
              <span className="h-1.5 flex-1 overflow-hidden rounded-full bg-muted">
                <span className="block h-full bg-foreground" style={{ width: `${Math.min(100, row.pct_complete * 100)}%` }} />
              </span>
            </>
          ) : (
            <span>—</span>
          )}
          <span>{row.latest_week_ending ? fmtDate(row.latest_week_ending) : '—'}</span>
        </div>
      </CardContent>
    </Card>
  )
}
