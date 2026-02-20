'use client'

import Link from 'next/link'
import {
  Truck,
  DollarSign,
  ShieldCheck,
  ClipboardCheck,
  TrendingUp,
  AlertTriangle,
  Download,
  ArrowRight,
} from 'lucide-react'
import { Card, CardContent } from '@/components/ui/card'

const reports = [
  {
    title: 'Fleet Summary',
    description: 'Fleet breakdown by equipment type with condition counts',
    href: '/reports/fleet-summary',
    icon: Truck,
    iconBg: 'bg-blue-100 dark:bg-blue-900',
    iconColor: 'text-blue-600 dark:text-blue-300',
  },
  {
    title: 'Maintenance Costs',
    description: 'Cost analysis by time period, fleet type, location, or plant',
    href: '/reports/maintenance-costs',
    icon: DollarSign,
    iconBg: 'bg-emerald-100 dark:bg-emerald-900',
    iconColor: 'text-emerald-600 dark:text-emerald-300',
  },
  {
    title: 'Verification Status',
    description: 'Physical verification rates by location',
    href: '/reports/verification',
    icon: ShieldCheck,
    iconBg: 'bg-violet-100 dark:bg-violet-900',
    iconColor: 'text-violet-600 dark:text-violet-300',
  },
  {
    title: 'Submission Compliance',
    description: 'Weekly report submission rates by location',
    href: '/reports/compliance',
    icon: ClipboardCheck,
    iconBg: 'bg-amber-100 dark:bg-amber-900',
    iconColor: 'text-amber-600 dark:text-amber-300',
  },
  {
    title: 'Weekly Trends & Movement',
    description: 'Weekly plant counts, verification trends, and transfer history',
    href: '/reports/trends',
    icon: TrendingUp,
    iconBg: 'bg-cyan-100 dark:bg-cyan-900',
    iconColor: 'text-cyan-600 dark:text-cyan-300',
  },
  {
    title: 'Unverified Plants',
    description: 'Plants missing physical verification in recent weeks',
    href: '/reports/unverified',
    icon: AlertTriangle,
    iconBg: 'bg-red-100 dark:bg-red-900',
    iconColor: 'text-red-600 dark:text-red-300',
  },
  {
    title: 'Export Data',
    description: 'Download plant and maintenance data as CSV or JSON',
    href: '/reports/export',
    icon: Download,
    iconBg: 'bg-slate-100 dark:bg-slate-800',
    iconColor: 'text-slate-600 dark:text-slate-300',
  },
]

export default function ReportsPage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Reports & Analytics</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Fleet reports, cost analysis, and data exports
        </p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {reports.map((report) => (
          <Link key={report.href} href={report.href}>
            <Card className="h-full hover:border-primary/50 hover:shadow-md transition-all group cursor-pointer">
              <CardContent className="pt-6">
                <div className="flex items-start gap-4">
                  <div className={`p-3 rounded-lg ${report.iconBg}`}>
                    <report.icon className={`h-6 w-6 ${report.iconColor}`} />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <h3 className="font-semibold text-sm">{report.title}</h3>
                      <ArrowRight className="h-3.5 w-3.5 text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity" />
                    </div>
                    <p className="text-xs text-muted-foreground mt-1 leading-relaxed">
                      {report.description}
                    </p>
                  </div>
                </div>
              </CardContent>
            </Card>
          </Link>
        ))}
      </div>
    </div>
  )
}
