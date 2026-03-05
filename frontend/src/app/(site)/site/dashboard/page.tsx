'use client'

import Link from 'next/link'
import { format, parseISO } from 'date-fns'
import {
  Wrench,
  Zap,
  AlertTriangle,
  HelpCircle,
  ClipboardList,
  ArrowRight,
  ArrowLeftRight,
  History,
  CheckCircle2,
  Clock,
  XCircle,
} from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Skeleton } from '@/components/ui/skeleton'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { useSiteStats, useSiteSubmissions, useIncomingTransfers } from '@/hooks/use-site-report'

function getCurrentWeekSunday(): string {
  const d = new Date()
  const day = d.getDay() // 0=Sun,1=Mon,...,6=Sat
  const offset = (7 - day) % 7   // 0 if today is Sun, else days until next Sun
  d.setDate(d.getDate() + offset)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

const SUBMISSION_STATUS: Record<string, { label: string; className: string; icon: React.ElementType }> = {
  completed: { label: 'Completed', className: 'bg-emerald-100 text-emerald-800', icon: CheckCircle2 },
  processing: { label: 'Processing', className: 'bg-blue-100 text-blue-800', icon: Clock },
  failed: { label: 'Failed', className: 'bg-red-100 text-red-800', icon: XCircle },
}

export default function SiteDashboardPage() {
  const { data: stats, isLoading: statsLoading } = useSiteStats()
  const { data: submissionsData, isLoading: subLoading } = useSiteSubmissions({ limit: 5 })
  const { data: incoming = [] } = useIncomingTransfers()

  const submissions = submissionsData?.data ?? []
  const thisWeek = getCurrentWeekSunday()

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-start justify-between">
        <div>
          {statsLoading ? (
            <Skeleton className="h-8 w-48 mb-1" />
          ) : (
            <h1 className="text-2xl font-bold tracking-tight">
              {stats?.location_name ?? 'My Site'}
            </h1>
          )}
          {stats?.state_name && (
            <p className="text-sm text-muted-foreground">{stats.state_name}</p>
          )}
        </div>
        <Button asChild>
          <Link href={`/site/report?week=${thisWeek}`}>
            <ClipboardList className="h-4 w-4 mr-2" />
            Fill This Week&apos;s Report
          </Link>
        </Button>
      </div>

      {/* Incoming transfers alert */}
      {incoming.length > 0 && (
        <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <ArrowLeftRight className="h-4 w-4 text-amber-600 shrink-0" />
            <span className="text-sm font-medium text-amber-800">
              {incoming.length} incoming transfer{incoming.length > 1 ? 's' : ''} awaiting confirmation
            </span>
          </div>
          <Button variant="outline" size="sm" asChild className="border-amber-300 text-amber-800 hover:bg-amber-100">
            <Link href="/site/transfers">View Transfers</Link>
          </Button>
        </div>
      )}

      {/* Stats cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {statsLoading ? (
          Array.from({ length: 8 }).map((_, i) => (
            <Card key={i}>
              <CardContent className="p-4">
                <Skeleton className="h-4 w-20 mb-2" />
                <Skeleton className="h-8 w-12" />
              </CardContent>
            </Card>
          ))
        ) : (
          <>
            <StatCard label="Total Plants" value={stats?.total_plants ?? 0} color="default" icon={null} />
            <StatCard label="Working" value={stats?.working ?? 0} color="emerald" icon={Zap} />
            <StatCard label="Standby" value={stats?.standby ?? 0} color="amber" icon={Clock} />
            <StatCard label="Breakdown" value={stats?.breakdown ?? 0} color="red" icon={Wrench} />
            <StatCard label="Faulty" value={stats?.faulty ?? 0} color="orange" icon={AlertTriangle} />
            <StatCard label="Missing" value={stats?.missing ?? 0} color="purple" icon={HelpCircle} />
            <StatCard label="Off Hire" value={stats?.off_hire ?? 0} color="gray" icon={null} />
            <StatCard label="Unverified" value={stats?.unverified ?? 0} color="blue" icon={null} />
          </>
        )}
      </div>

      {/* Recent submissions */}
      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between">
            <CardTitle className="text-base">Recent Submissions</CardTitle>
            <Button variant="ghost" size="sm" asChild className="text-xs">
              <Link href="/site/submissions">
                View all <ArrowRight className="h-3 w-3 ml-1" />
              </Link>
            </Button>
          </div>
        </CardHeader>
        <CardContent className="pt-0">
          {subLoading ? (
            <div className="space-y-2">
              {Array.from({ length: 3 }).map((_, i) => (
                <Skeleton key={i} className="h-10 w-full" />
              ))}
            </div>
          ) : submissions.length === 0 ? (
            <div className="text-center py-8">
              <History className="h-10 w-10 mx-auto mb-2 text-muted-foreground opacity-40" />
              <p className="text-sm text-muted-foreground">No submissions yet</p>
              <p className="text-xs text-muted-foreground mt-1">
                Submit your first weekly report to see it here
              </p>
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Week Ending</TableHead>
                  <TableHead className="text-center">Week No.</TableHead>
                  <TableHead className="text-center">Plants</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Submitted</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {submissions.map((s) => {
                  const style = SUBMISSION_STATUS[s.status] ?? SUBMISSION_STATUS.completed
                  const StatusIcon = style.icon
                  return (
                    <TableRow key={s.id}>
                      <TableCell className="font-medium text-sm">
                        {format(parseISO(s.week_ending_date + 'T00:00:00'), 'dd MMM yyyy')}
                      </TableCell>
                      <TableCell className="text-center text-sm text-muted-foreground">
                        Wk {s.week_number}
                      </TableCell>
                      <TableCell className="text-center text-sm">
                        {s.plants_processed ?? '—'}
                      </TableCell>
                      <TableCell>
                        <Badge variant="outline" className={`text-xs ${style.className}`}>
                          <StatusIcon className="h-3 w-3 mr-1" />
                          {style.label}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground">
                        {format(parseISO(s.created_at), 'dd MMM yyyy, HH:mm')}
                      </TableCell>
                    </TableRow>
                  )
                })}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  )
}

function StatCard({
  label,
  value,
  color,
  icon: Icon,
}: {
  label: string
  value: number
  color: string
  icon: React.ElementType | null
}) {
  const colorMap: Record<string, string> = {
    default: 'text-foreground',
    emerald: 'text-emerald-600',
    amber: 'text-amber-600',
    red: 'text-red-600',
    orange: 'text-orange-600',
    purple: 'text-purple-600',
    gray: 'text-gray-500',
    blue: 'text-blue-600',
  }
  const iconColorMap: Record<string, string> = {
    default: 'text-muted-foreground',
    emerald: 'text-emerald-400',
    amber: 'text-amber-400',
    red: 'text-red-400',
    orange: 'text-orange-400',
    purple: 'text-purple-400',
    gray: 'text-gray-400',
    blue: 'text-blue-400',
  }
  return (
    <Card>
      <CardContent className="p-4">
        <div className="flex items-center justify-between mb-1">
          <p className="text-xs text-muted-foreground">{label}</p>
          {Icon && <Icon className={`h-3.5 w-3.5 ${iconColorMap[color] ?? ''}`} />}
        </div>
        <p className={`text-2xl font-bold ${colorMap[color] ?? ''}`}>{value}</p>
      </CardContent>
    </Card>
  )
}
