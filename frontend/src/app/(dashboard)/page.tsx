'use client'

import Link from 'next/link'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { Badge } from '@/components/ui/badge'
import {
  Truck,
  Users,
  ArrowRight,
  CheckCircle,
  AlertTriangle,
  ShieldCheck,
  Activity,
  MapPin,
  FileUp,
  Wrench,
  CircleDot,
  Plus,
  Calendar,
} from 'lucide-react'
import { useAuth } from '@/providers/auth-provider'
import { useDashboardSummary, usePlantEvents } from '@/hooks/use-dashboard'
import { usePlants } from '@/hooks/use-plants'
import type { DashboardPlantStats, LocationStat, RecentSubmission } from '@/lib/api/dashboard'
import type { PlantSummary } from '@/lib/api/plants'

// ---------------------------------------------------------------------------
// Condition config for the breakdown section
// ---------------------------------------------------------------------------
const CONDITIONS = [
  { key: 'working_plants', label: 'Working', color: 'bg-emerald-500' },
  { key: 'standby_plants', label: 'Standby', color: 'bg-amber-400' },
  { key: 'under_repair_plants', label: 'Under Repair', color: 'bg-blue-500' },
  { key: 'missing_plants', label: 'Missing', color: 'bg-red-400' },
  { key: 'breakdown_plants', label: 'Breakdown', color: 'bg-red-600' },
  { key: 'faulty_plants', label: 'Faulty', color: 'bg-orange-500' },
  { key: 'scrap_plants', label: 'Scrap', color: 'bg-gray-400' },
  { key: 'off_hire_plants', label: 'Off Hire', color: 'bg-slate-500' },
  { key: 'gpm_assessment_plants', label: 'GPM Assessment', color: 'bg-purple-500' },
  { key: 'unverified_condition_plants', label: 'Unverified', color: 'bg-gray-300' },
] as const

// ---------------------------------------------------------------------------
// Main Dashboard
// ---------------------------------------------------------------------------
export default function DashboardPage() {
  const { user } = useAuth()
  const { data: summary, isLoading } = useDashboardSummary()
  const { data: eventsData, isLoading: eventsLoading } = usePlantEvents({ limit: 5 })
  const { data: recentPlantsData, isLoading: recentPlantsLoading } = usePlants({
    sort_by: 'created_at',
    sort_order: 'desc',
    limit: 30,
  })

  const plants = summary?.plants
  const verificationRate = plants
    ? Math.round((plants.verified_plants / Math.max(plants.total_plants, 1)) * 1000) / 10
    : 0

  return (
    <div className="space-y-6">
      {/* Welcome Header */}
      <div>
        <h1 className="text-2xl font-bold tracking-tight">
          Welcome back, {user?.full_name || 'there'}
        </h1>
        <p className="text-sm text-muted-foreground mt-1">
          Overview of your fleet operations
        </p>
      </div>

      {/* KPI Cards */}
      {isLoading ? (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-[120px]" />
          ))}
        </div>
      ) : plants ? (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          <KpiCard
            title="Total Fleet"
            value={plants.total_plants.toLocaleString()}
            icon={Truck}
            iconBg="bg-blue-100 dark:bg-blue-900"
            iconColor="text-blue-600 dark:text-blue-300"
            subtitle={`${plants.working_plants + plants.standby_plants} operational`}
          />
          <KpiCard
            title="Working"
            value={plants.working_plants.toLocaleString()}
            icon={CheckCircle}
            iconBg="bg-emerald-100 dark:bg-emerald-900"
            iconColor="text-emerald-600 dark:text-emerald-300"
            subtitle={`${Math.round((plants.working_plants / Math.max(plants.total_plants, 1)) * 100)}% of fleet`}
          />
          <KpiCard
            title="Breakdown"
            value={plants.breakdown_plants.toLocaleString()}
            icon={AlertTriangle}
            iconBg="bg-red-100 dark:bg-red-900"
            iconColor="text-red-600 dark:text-red-300"
            subtitle={plants.breakdown_plants > 0 ? 'Needs attention' : 'All clear'}
            alert={plants.breakdown_plants > 0}
          />
          <KpiCard
            title="Verification Rate"
            value={`${verificationRate}%`}
            icon={ShieldCheck}
            iconBg="bg-violet-100 dark:bg-violet-900"
            iconColor="text-violet-600 dark:text-violet-300"
            subtitle={`${plants.verified_plants.toLocaleString()} of ${plants.total_plants.toLocaleString()} verified`}
          />
        </div>
      ) : null}

      {/* Middle Section: Condition Breakdown + Top Sites */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Condition Breakdown */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base flex items-center gap-2">
              <Activity className="h-4 w-4" />
              Fleet Condition Breakdown
            </CardTitle>
          </CardHeader>
          <CardContent>
            {isLoading ? (
              <div className="space-y-3">
                {Array.from({ length: 5 }).map((_, i) => (
                  <Skeleton key={i} className="h-6 w-full" />
                ))}
              </div>
            ) : plants ? (
              <ConditionBreakdown plants={plants} />
            ) : (
              <p className="text-sm text-muted-foreground">No data available</p>
            )}
          </CardContent>
        </Card>

        {/* Top Sites */}
        <Card>
          <CardHeader className="pb-3">
            <div className="flex items-center justify-between">
              <CardTitle className="text-base flex items-center gap-2">
                <MapPin className="h-4 w-4" />
                Top Sites by Plant Count
              </CardTitle>
              <Link
                href="/plants"
                className="text-xs text-primary hover:underline flex items-center gap-1"
              >
                View all <ArrowRight className="h-3 w-3" />
              </Link>
            </div>
          </CardHeader>
          <CardContent>
            {isLoading ? (
              <div className="space-y-3">
                {Array.from({ length: 5 }).map((_, i) => (
                  <Skeleton key={i} className="h-8 w-full" />
                ))}
              </div>
            ) : summary?.top_locations ? (
              <TopSitesTable locations={summary.top_locations} />
            ) : (
              <p className="text-sm text-muted-foreground">No data available</p>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Weekly Submissions + Recently Added Plants */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Weekly Submissions (last 2 weeks) */}
        <Card className="flex flex-col">
          <CardHeader className="pb-3">
            <div className="flex items-center justify-between">
              <CardTitle className="text-base flex items-center gap-2">
                <FileUp className="h-4 w-4" />
                Weekly Submissions
              </CardTitle>
              <Badge variant="outline" className="text-xs font-normal gap-1">
                <Calendar className="h-3 w-3" />
                Week {getCurrentWeek()} · {new Date().getFullYear()}
              </Badge>
            </div>
            <p className="text-xs text-muted-foreground">Latest uploads as reports come in</p>
          </CardHeader>
          <CardContent className="flex-1 min-h-0">
            {isLoading ? (
              <div className="space-y-3">
                {Array.from({ length: 4 }).map((_, i) => (
                  <Skeleton key={i} className="h-12 w-full" />
                ))}
              </div>
            ) : summary?.recent_submissions && summary.recent_submissions.length > 0 ? (
              <div className="max-h-[400px] overflow-y-auto pr-1">
                <RecentSubmissionsList submissions={summary.recent_submissions} />
              </div>
            ) : (
              <p className="text-sm text-muted-foreground py-4 text-center">
                No submissions yet
              </p>
            )}
          </CardContent>
        </Card>

        {/* Recently Added Plants (last 30 days) */}
        <Card className="flex flex-col">
          <CardHeader className="pb-3">
            <div className="flex items-center justify-between">
              <CardTitle className="text-base flex items-center gap-2">
                <Plus className="h-4 w-4" />
                Recently Added Plants
              </CardTitle>
              <Link
                href="/plants?sort_by=created_at&sort_order=desc"
                className="text-xs text-primary hover:underline flex items-center gap-1"
              >
                View all <ArrowRight className="h-3 w-3" />
              </Link>
            </div>
            <p className="text-xs text-muted-foreground">Last 30 days</p>
          </CardHeader>
          <CardContent className="flex-1 min-h-0">
            {recentPlantsLoading ? (
              <div className="space-y-3">
                {Array.from({ length: 4 }).map((_, i) => (
                  <Skeleton key={i} className="h-12 w-full" />
                ))}
              </div>
            ) : recentPlantsData?.data && recentPlantsData.data.length > 0 ? (
              <div className="max-h-[400px] overflow-y-auto pr-1">
                <RecentlyAddedList plants={recentPlantsData.data} />
              </div>
            ) : (
              <p className="text-sm text-muted-foreground py-4 text-center">
                No plants added yet
              </p>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Recent Events + Quick Actions */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Recent Events */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base flex items-center gap-2">
              <CircleDot className="h-4 w-4" />
              Recent Events
            </CardTitle>
          </CardHeader>
          <CardContent>
            {eventsLoading ? (
              <div className="space-y-3">
                {Array.from({ length: 3 }).map((_, i) => (
                  <Skeleton key={i} className="h-10 w-full" />
                ))}
              </div>
            ) : eventsData?.data && eventsData.data.length > 0 ? (
              <div className="space-y-3">
                {eventsData.data.map((event) => (
                  <div key={event.id} className="flex items-start gap-3 text-sm">
                    <EventTypeBadge type={event.event_type} />
                    <div className="flex-1 min-w-0">
                      <p className="font-medium truncate">
                        <Link
                          href={`/plants/${event.plant_id}`}
                          className="hover:underline"
                        >
                          {event.fleet_number}
                        </Link>
                      </p>
                      <p className="text-xs text-muted-foreground truncate">
                        {event.remarks || event.event_type.replace(/_/g, ' ')}
                      </p>
                    </div>
                    <span className="text-xs text-muted-foreground whitespace-nowrap">
                      {formatRelativeDate(event.event_date)}
                    </span>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-sm text-muted-foreground py-4 text-center">
                No recent events
              </p>
            )}
          </CardContent>
        </Card>

        {/* Quick Actions */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Quick Actions</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            <QuickAction
              href="/plants"
              icon={Truck}
              label="View Plants"
              description="Browse and filter equipment fleet"
            />
            {user?.role === 'admin' && (
              <>
                <QuickAction
                  href="/plants/create"
                  icon={Wrench}
                  label="Add Plant"
                  description="Create a new plant record"
                />
                <QuickAction
                  href="/admin/users"
                  icon={Users}
                  label="Manage Users"
                  description="Manage system users and roles"
                />
              </>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// KPI Card
// ---------------------------------------------------------------------------
function KpiCard({
  title,
  value,
  icon: Icon,
  iconBg,
  iconColor,
  subtitle,
  alert,
}: {
  title: string
  value: string
  icon: React.ElementType
  iconBg: string
  iconColor: string
  subtitle: string
  alert?: boolean
}) {
  return (
    <Card className={alert ? 'border-red-200 dark:border-red-800' : undefined}>
      <CardContent className="pt-6">
        <div className="flex items-start justify-between">
          <div>
            <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
              {title}
            </p>
            <p className="text-2xl font-bold mt-1">{value}</p>
            <p className="text-xs text-muted-foreground mt-1">{subtitle}</p>
          </div>
          <div className={`p-2.5 rounded-lg ${iconBg}`}>
            <Icon className={`h-5 w-5 ${iconColor}`} />
          </div>
        </div>
      </CardContent>
    </Card>
  )
}

// ---------------------------------------------------------------------------
// Condition Breakdown with progress bars
// ---------------------------------------------------------------------------
function ConditionBreakdown({ plants }: { plants: DashboardPlantStats }) {
  const total = plants.total_plants || 1

  return (
    <div className="space-y-3">
      {CONDITIONS.map(({ key, label, color }) => {
        const count = plants[key]
        if (count === 0) return null
        const pct = Math.round((count / total) * 100)
        return (
          <div key={key} className="flex items-center gap-3">
            <span className="text-sm w-28 shrink-0">{label}</span>
            <div className="flex-1">
              <div className="h-2 rounded-full bg-muted overflow-hidden">
                <div
                  className={`h-full rounded-full ${color}`}
                  style={{ width: `${Math.max(pct, 1)}%` }}
                />
              </div>
            </div>
            <span className="text-sm font-medium w-12 text-right">
              {count.toLocaleString()}
            </span>
            <span className="text-xs text-muted-foreground w-10 text-right">
              {pct}%
            </span>
          </div>
        )
      })}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Top Sites Table
// ---------------------------------------------------------------------------
function TopSitesTable({ locations }: { locations: LocationStat[] }) {
  return (
    <div className="overflow-x-auto -mx-6">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead className="pl-6">Site</TableHead>
            <TableHead className="text-right">Total</TableHead>
            <TableHead className="text-right">Working</TableHead>
            <TableHead className="text-right pr-6">Breakdown</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {locations.slice(0, 8).map((loc) => (
            <TableRow key={loc.id}>
              <TableCell className="pl-6">
                <div>
                  <span className="font-medium text-sm">{loc.location_name}</span>
                  {loc.state_code && (
                    <span className="text-xs text-muted-foreground ml-1.5">
                      {loc.state_code}
                    </span>
                  )}
                </div>
              </TableCell>
              <TableCell className="text-right font-medium">
                {loc.total_plants}
              </TableCell>
              <TableCell className="text-right text-emerald-600 dark:text-emerald-400">
                {loc.working_plants}
              </TableCell>
              <TableCell className="text-right pr-6">
                {loc.breakdown_plants > 0 ? (
                  <span className="text-red-600 dark:text-red-400">{loc.breakdown_plants}</span>
                ) : (
                  <span className="text-muted-foreground">0</span>
                )}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Recently Added Plants List — grouped by date
// ---------------------------------------------------------------------------
function RecentlyAddedList({ plants }: { plants: PlantSummary[] }) {
  // Group plants by date (YYYY-MM-DD)
  const grouped: { dateKey: string; dateLabel: string; items: PlantSummary[] }[] = []
  const seen = new Map<string, PlantSummary[]>()

  for (const plant of plants) {
    const d = plant.created_at ? new Date(plant.created_at) : null
    const dateKey = d ? d.toISOString().slice(0, 10) : 'unknown'
    if (!seen.has(dateKey)) {
      const items: PlantSummary[] = []
      seen.set(dateKey, items)
      grouped.push({
        dateKey,
        dateLabel: d ? formatGroupDate(d) : 'Unknown',
        items,
      })
    }
    seen.get(dateKey)!.push(plant)
  }

  return (
    <div className="space-y-4">
      {grouped.map((group) => (
        <div key={group.dateKey}>
          <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">
            {group.dateLabel}
            <span className="ml-1.5 font-normal">({group.items.length})</span>
          </p>
          <div className="space-y-1">
            {group.items.map((plant) => (
              <Link
                key={plant.id}
                href={`/plants/${plant.id}`}
                className="flex items-center gap-3 group hover:bg-muted/50 rounded-lg p-2 -mx-2 transition-colors"
              >
                <div className="p-1.5 rounded-md bg-emerald-100 dark:bg-emerald-900">
                  <Plus className="h-3.5 w-3.5 text-emerald-600 dark:text-emerald-300" />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-medium font-mono">{plant.fleet_number}</span>
                    {plant.fleet_type && (
                      <span className="text-xs text-muted-foreground">{plant.fleet_type}</span>
                    )}
                  </div>
                  <p className="text-xs text-muted-foreground truncate">
                    {plant.description || 'No description'}{plant.current_location ? ` · ${plant.current_location}` : ''}
                  </p>
                </div>
              </Link>
            ))}
          </div>
        </div>
      ))}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Recent Submissions List — grouped by This Week / Last Week / Earlier
// ---------------------------------------------------------------------------
const SUBMISSION_STATUS_COLORS: Record<string, string> = {
  processed: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900 dark:text-emerald-300',
  pending: 'bg-amber-100 text-amber-700 dark:bg-amber-900 dark:text-amber-300',
  failed: 'bg-red-100 text-red-700 dark:bg-red-900 dark:text-red-300',
  processing: 'bg-blue-100 text-blue-700 dark:bg-blue-900 dark:text-blue-300',
}

function RecentSubmissionsList({ submissions }: { submissions: RecentSubmission[] }) {
  const currentWeek = getCurrentWeek()
  const currentYear = new Date().getFullYear()

  // Group submissions into This Week / Last Week / Earlier
  const thisWeek: RecentSubmission[] = []
  const lastWeek: RecentSubmission[] = []
  const earlier: RecentSubmission[] = []

  for (const sub of submissions) {
    if (sub.year === currentYear && sub.week_number === currentWeek) {
      thisWeek.push(sub)
    } else if (
      (sub.year === currentYear && sub.week_number === currentWeek - 1) ||
      (currentWeek === 1 && sub.year === currentYear - 1)
    ) {
      lastWeek.push(sub)
    } else {
      earlier.push(sub)
    }
  }

  const groups = [
    { label: 'This Week', items: thisWeek, accent: 'text-emerald-600 dark:text-emerald-400' },
    { label: 'Last Week', items: lastWeek, accent: 'text-blue-600 dark:text-blue-400' },
    { label: 'Earlier', items: earlier, accent: 'text-muted-foreground' },
  ].filter((g) => g.items.length > 0)

  return (
    <div className="space-y-4">
      {groups.map((group) => (
        <div key={group.label}>
          <p className={`text-xs font-semibold uppercase tracking-wider mb-2 ${group.accent}`}>
            {group.label}
            <span className="ml-1.5 text-muted-foreground font-normal">
              ({group.items.length})
            </span>
          </p>
          <div className="space-y-2">
            {group.items.map((sub) => (
              <SubmissionRow key={sub.id} sub={sub} />
            ))}
          </div>
        </div>
      ))}
    </div>
  )
}

function SubmissionRow({ sub }: { sub: RecentSubmission }) {
  const weekEnd = new Date(sub.week_ending_date)
  const dateStr = weekEnd.toLocaleDateString('en-NG', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  })

  return (
    <div className="flex items-center gap-3 rounded-lg p-2 -mx-2 hover:bg-muted/50 transition-colors">
      <div className="p-1.5 rounded-md bg-blue-100 dark:bg-blue-900">
        <FileUp className="h-3.5 w-3.5 text-blue-600 dark:text-blue-300" />
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium">
            Week {sub.week_number}
          </span>
          <span className="text-xs text-muted-foreground">
            · {dateStr}
          </span>
          <Badge
            variant="secondary"
            className={`text-[10px] px-1.5 py-0 h-4 ${SUBMISSION_STATUS_COLORS[sub.status] || ''}`}
          >
            {sub.status}
          </Badge>
        </div>
        <p className="text-xs text-muted-foreground truncate">
          {sub.location_name || 'Unknown site'} · {sub.plants_processed} plants processed
        </p>
      </div>
      <span className="text-xs text-muted-foreground whitespace-nowrap">
        {formatRelativeDate(sub.submitted_at)}
      </span>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Event Type Badge
// ---------------------------------------------------------------------------
const EVENT_COLORS: Record<string, string> = {
  movement: 'bg-blue-500',
  missing: 'bg-red-500',
  new: 'bg-emerald-500',
  returned: 'bg-amber-500',
  verification_failed: 'bg-orange-500',
}

function EventTypeBadge({ type }: { type: string }) {
  return (
    <div className={`w-2 h-2 rounded-full mt-1.5 shrink-0 ${EVENT_COLORS[type] || 'bg-gray-400'}`} />
  )
}

// ---------------------------------------------------------------------------
// Quick Action Link
// ---------------------------------------------------------------------------
function QuickAction({
  href,
  icon: Icon,
  label,
  description,
}: {
  href: string
  icon: React.ElementType
  label: string
  description: string
}) {
  return (
    <Link
      href={href}
      className="flex items-center gap-3 p-3 rounded-lg hover:bg-muted transition-colors group"
    >
      <div className="p-2 rounded-lg bg-muted group-hover:bg-background transition-colors">
        <Icon className="h-4 w-4 text-muted-foreground" />
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium">{label}</p>
        <p className="text-xs text-muted-foreground">{description}</p>
      </div>
      <ArrowRight className="h-4 w-4 text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity" />
    </Link>
  )
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function formatGroupDate(date: Date): string {
  const now = new Date()
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  const target = new Date(date.getFullYear(), date.getMonth(), date.getDate())
  const diffDays = Math.floor((today.getTime() - target.getTime()) / 86400000)

  if (diffDays === 0) return 'Today'
  if (diffDays === 1) return 'Yesterday'
  return date.toLocaleDateString('en-NG', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' })
}

function getCurrentWeek(): number {
  const now = new Date()
  const startOfYear = new Date(now.getFullYear(), 0, 1)
  const pastDays = (now.getTime() - startOfYear.getTime()) / 86400000
  return Math.ceil((pastDays + startOfYear.getDay() + 1) / 7)
}

function formatRelativeDate(dateStr: string): string {
  const date = new Date(dateStr)
  const now = new Date()
  const diffDays = Math.floor((now.getTime() - date.getTime()) / (1000 * 60 * 60 * 24))

  if (diffDays === 0) return 'Today'
  if (diffDays === 1) return 'Yesterday'
  if (diffDays < 7) return `${diffDays}d ago`
  if (diffDays < 30) return `${Math.floor(diffDays / 7)}w ago`
  return date.toLocaleDateString('en-NG', { month: 'short', day: 'numeric' })
}
