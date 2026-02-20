'use client'

import { useState } from 'react'
import Link from 'next/link'
import { ArrowLeft, ShieldCheck } from 'lucide-react'
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Input } from '@/components/ui/input'
import { useVerificationStatus } from '@/hooks/use-reports'

const currentYear = new Date().getFullYear()
const YEAR_OPTIONS = Array.from({ length: 5 }, (_, i) => currentYear - i)

function rateColor(rate: number): string {
  if (rate < 50) return 'text-red-600 dark:text-red-400'
  if (rate < 80) return 'text-amber-600 dark:text-amber-400'
  return 'text-emerald-600 dark:text-emerald-400'
}

function rateBg(rate: number): string {
  if (rate < 50) return 'bg-red-500'
  if (rate < 80) return 'bg-amber-500'
  return 'bg-emerald-500'
}

export default function VerificationStatusPage() {
  const [year, setYear] = useState<number>(currentYear)
  const [weekNumber, setWeekNumber] = useState<string>('')

  const { data, isLoading } = useVerificationStatus({
    year,
    week_number: weekNumber ? Number(weekNumber) : undefined,
  })

  const sorted = data
    ? [...data].sort((a, b) => Number(a.verification_rate) - Number(b.verification_rate))
    : []

  const avgRate = sorted.length > 0
    ? sorted.reduce((s, d) => s + Number(d.verification_rate), 0) / sorted.length
    : 0

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center gap-3">
        <Link
          href="/reports"
          className="p-2 rounded-lg hover:bg-muted transition-colors"
        >
          <ArrowLeft className="h-4 w-4" />
        </Link>
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Verification Status</h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            Physical verification rates by location
          </p>
        </div>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap gap-3">
        <Select value={String(year)} onValueChange={(v) => setYear(Number(v))}>
          <SelectTrigger className="w-[130px]">
            <SelectValue placeholder="Year" />
          </SelectTrigger>
          <SelectContent>
            {YEAR_OPTIONS.map((y) => (
              <SelectItem key={y} value={String(y)}>
                {y}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Input
          type="number"
          placeholder="Week number"
          value={weekNumber}
          onChange={(e) => setWeekNumber(e.target.value)}
          className="w-[140px]"
          min={1}
          max={53}
        />
      </div>

      {/* Summary */}
      {sorted.length > 0 && (
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center gap-3">
              <div className="p-2.5 rounded-lg bg-violet-100 dark:bg-violet-900">
                <ShieldCheck className="h-5 w-5 text-violet-600 dark:text-violet-300" />
              </div>
              <div>
                <p className="text-xs text-muted-foreground uppercase tracking-wider">
                  Average Verification Rate
                </p>
                <p className={`text-2xl font-bold ${rateColor(avgRate)}`}>
                  {avgRate.toFixed(1)}%
                </p>
                <p className="text-xs text-muted-foreground">
                  {sorted.length} location{sorted.length !== 1 ? 's' : ''}
                </p>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {isLoading ? (
        <Skeleton className="h-[300px] w-full" />
      ) : sorted.length > 0 ? (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">
              Verification by Location (sorted worst first)
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="rounded-md border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Location</TableHead>
                    <TableHead className="text-right">Total Plants</TableHead>
                    <TableHead className="text-right">Verified</TableHead>
                    <TableHead className="w-[200px]">Rate</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {sorted.map((row) => {
                    const rate = Number(row.verification_rate)
                    return (
                      <TableRow key={row.location_id}>
                        <TableCell className="font-medium">
                          {row.location_name}
                        </TableCell>
                        <TableCell className="text-right font-mono">
                          {Number(row.total_plants).toLocaleString()}
                        </TableCell>
                        <TableCell className="text-right font-mono">
                          {Number(row.verified_plants).toLocaleString()}
                        </TableCell>
                        <TableCell>
                          <div className="flex items-center gap-2">
                            <div className="flex-1 h-2 rounded-full bg-muted overflow-hidden">
                              <div
                                className={`h-full rounded-full ${rateBg(rate)}`}
                                style={{ width: `${Math.max(rate, 1)}%` }}
                              />
                            </div>
                            <span className={`text-sm font-medium w-14 text-right ${rateColor(rate)}`}>
                              {rate.toFixed(1)}%
                            </span>
                          </div>
                        </TableCell>
                      </TableRow>
                    )
                  })}
                </TableBody>
              </Table>
            </div>
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardContent className="py-12 text-center">
            <ShieldCheck className="h-10 w-10 mx-auto text-muted-foreground/50 mb-3" />
            <p className="font-medium">No verification data</p>
            <p className="text-sm text-muted-foreground mt-1">
              Verification status will appear after weekly reports are processed.
            </p>
          </CardContent>
        </Card>
      )}
    </div>
  )
}
