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
  ArrowRight,
  MapPin,
  FileUp,
  PackagePlus,
  Calendar,
  Truck,
  Users,
  Wrench,
} from 'lucide-react'
import { useAuth } from '@/providers/auth-provider'
import { useDashboardSummary, useRecentlyPurchased } from '@/hooks/use-dashboard'
import type { LocationStat, RecentSubmission } from '@/lib/api/dashboard'

// Dashboard chart components
import { KpiCards } from '@/components/dashboard/kpi-cards'
import { ConditionDonutChart } from '@/components/dashboard/condition-donut-chart'
import { FleetTypeBarChart } from '@/components/dashboard/fleet-type-bar-chart'
import { NigeriaMapChart } from '@/components/dashboard/nigeria-map-chart'
import { CostTrendChart } from '@/components/dashboard/cost-trend-chart'

// ---------------------------------------------------------------------------
// Main Dashboard
// ---------------------------------------------------------------------------
export default function DashboardPage() {
  const { user } = useAuth()

  const { data: summary, isLoading } = useDashboardSummary()
  const { data: recentPurchases, isLoading: purchasesLoading } = useRecentlyPurchased(8)
  const plants = summary?.plants

  return (
    <div className="space-y-4 sm:space-y-6">
      {/* Welcome */}
      <div>
        <h1 className="text-2xl font-bold tracking-tight">
          Welcome back, {user?.full_name || 'there'}
        </h1>
        <p className="text-sm text-muted-foreground mt-1">
          Overview of your fleet operations
        </p>
      </div>

      {/* KPI Cards */}
      <KpiCards
        plants={plants}
        totalSites={summary?.total_sites ?? 0}
        totalStates={summary?.total_states ?? 0}
        isLoading={isLoading}
      />

      {/* Row: Condition Donut + Fleet Type Bar */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-4 sm:gap-6">
        <div className="lg:col-span-4">
          <ConditionDonutChart plants={plants} isLoading={isLoading} />
        </div>
        <div className="lg:col-span-8">
          <FleetTypeBarChart />
        </div>
      </div>

      {/* Row: Nigeria Map (full width — has built-in filters & state detail sidebar) */}
      <NigeriaMapChart />

      {/* Row: Top Sites */}
      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between">
            <CardTitle className="text-base flex items-center gap-2">
              <MapPin className="h-4 w-4" />
              Top Sites
            </CardTitle>
            <Link
              href="/locations"
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
            <p className="text-sm text-muted-foreground">No data</p>
          )}
        </CardContent>
      </Card>

      {/* Row: Cost Trend + Submissions */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 sm:gap-6">
        <CostTrendChart />

        {/* Weekly Submissions */}
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
          </CardHeader>
          <CardContent className="flex-1 min-h-0">
            {isLoading ? (
              <div className="space-y-3">
                {Array.from({ length: 4 }).map((_, i) => (
                  <Skeleton key={i} className="h-12 w-full" />
                ))}
              </div>
            ) : summary?.recent_submissions && summary.recent_submissions.length > 0 ? (
              <div className="max-h-[300px] overflow-y-auto pr-1">
                <RecentSubmissionsList submissions={summary.recent_submissions} />
              </div>
            ) : (
              <p className="text-sm text-muted-foreground py-4 text-center">
                No submissions yet
              </p>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Row: Recently Purchased + Quick Actions */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 sm:gap-6 print:hidden">
        {/* Recently Purchased Plants */}
        <Card>
          <CardHeader className="pb-3">
            <div className="flex items-center justify-between">
              <CardTitle className="text-base flex items-center gap-2">
                <PackagePlus className="h-4 w-4" />
                Recently Purchased
              </CardTitle>
              <Link
                href="/plants?sort_by=purchase_year&sort_order=desc"
                className="text-xs text-primary hover:underline flex items-center gap-1"
              >
                View all <ArrowRight className="h-3 w-3" />
              </Link>
            </div>
          </CardHeader>
          <CardContent>
            {purchasesLoading ? (
              <div className="space-y-3">
                {Array.from({ length: 4 }).map((_, i) => (
                  <Skeleton key={i} className="h-10 w-full" />
                ))}
              </div>
            ) : recentPurchases && recentPurchases.length > 0 ? (
              <div className="max-h-[300px] overflow-y-auto pr-1 space-y-2">
                {recentPurchases.map((plant) => (
                  <div
                    key={plant.id}
                    className="flex items-center gap-3 rounded-lg p-2 -mx-2 hover:bg-muted/50 transition-colors"
                  >
                    <div className="p-1.5 rounded-md bg-emerald-100 dark:bg-emerald-900/50">
                      <Truck className="h-3.5 w-3.5 text-emerald-600 dark:text-emerald-300" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <Link
                          href={`/plants/${plant.id}`}
                          className="text-sm font-medium hover:underline"
                        >
                          {plant.fleet_number}
                        </Link>
                        {plant.fleet_type && (
                          <span className="text-[10px] text-muted-foreground bg-muted px-1.5 py-0.5 rounded">
                            {plant.fleet_type}
                          </span>
                        )}
                      </div>
                      <p className="text-xs text-muted-foreground truncate">
                        {plant.description || plant.make || 'No description'}
                        {plant.current_location && ` · ${plant.current_location}`}
                      </p>
                    </div>
                    <span className="text-xs text-muted-foreground whitespace-nowrap">
                      {formatPurchaseDate(plant.purchase_year, plant.purchase_month)}
                    </span>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-sm text-muted-foreground py-4 text-center">
                No purchase data available
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
            <QuickAction href="/plants" icon={Truck} label="View Plants" description="Browse and filter equipment fleet" />
            {user?.role === 'admin' && (
              <>
                <QuickAction href="/plants/create" icon={Wrench} label="Add Plant" description="Create a new plant record" />
                <QuickAction href="/admin/users" icon={Users} label="Manage Users" description="Manage system users and roles" />
              </>
            )}
          </CardContent>
        </Card>
      </div>
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
            <TableHead className="text-right pr-6">Down</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {locations.slice(0, 8).map((loc) => (
            <TableRow key={loc.id}>
              <TableCell className="pl-6">
                <div>
                  <span className="font-medium text-sm">{loc.location_name}</span>
                  {loc.state_code && (
                    <span className="text-xs text-muted-foreground ml-1.5">{loc.state_code}</span>
                  )}
                </div>
              </TableCell>
              <TableCell className="text-right font-medium">{loc.total_plants}</TableCell>
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
// Recent Submissions List
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
            <span className="ml-1.5 text-muted-foreground font-normal">({group.items.length})</span>
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
  const dateStr = weekEnd.toLocaleDateString('en-NG', { month: 'short', day: 'numeric', year: 'numeric' })

  return (
    <div className="flex items-center gap-3 rounded-lg p-2 -mx-2 hover:bg-muted/50 transition-colors">
      <div className="p-1.5 rounded-md bg-blue-100 dark:bg-blue-900">
        <FileUp className="h-3.5 w-3.5 text-blue-600 dark:text-blue-300" />
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium">Week {sub.week_number}</span>
          <span className="text-xs text-muted-foreground">· {dateStr}</span>
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
function getCurrentWeek(): number {
  const now = new Date()
  const startOfYear = new Date(now.getFullYear(), 0, 1)
  const pastDays = (now.getTime() - startOfYear.getTime()) / 86400000
  return Math.ceil((pastDays + startOfYear.getDay() + 1) / 7)
}

const MONTH_ABBR = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

function formatPurchaseDate(year: number, month: number | null): string {
  if (month) return `${MONTH_ABBR[month - 1]} ${year}`
  return String(year)
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
