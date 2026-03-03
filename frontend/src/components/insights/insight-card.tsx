'use client'

import { AlertTriangle, AlertCircle, Info, Check, MapPin, Clock, ChevronDown, ChevronUp } from 'lucide-react'
import { useState } from 'react'
import Link from 'next/link'
import { Card, CardContent } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import type { Insight } from '@/lib/api/insights'

interface InsightCardProps {
  insight: Insight
  onAcknowledge?: (id: string) => void
  isAcknowledging?: boolean
}

const SEVERITY_CONFIG = {
  critical: {
    icon: AlertTriangle,
    color: 'text-red-600',
    bg: 'bg-red-50 dark:bg-red-950/30',
    border: 'border-red-200 dark:border-red-900',
    badge: 'destructive' as const,
  },
  warning: {
    icon: AlertCircle,
    color: 'text-amber-600',
    bg: 'bg-amber-50 dark:bg-amber-950/30',
    border: 'border-amber-200 dark:border-amber-900',
    badge: 'outline' as const,
  },
  info: {
    icon: Info,
    color: 'text-blue-600',
    bg: 'bg-blue-50 dark:bg-blue-950/30',
    border: 'border-blue-200 dark:border-blue-900',
    badge: 'secondary' as const,
  },
}

const TYPE_LABELS: Record<string, string> = {
  fleet_overview: 'Fleet Overview',
  condition_change: 'Condition Change',
  utilization_alert: 'Utilization',
  missing_plants: 'Missing Plants',
  chronic_breakdown: 'Chronic Breakdown',
  idle_fleet: 'Idle Fleet',
  fleet_rebalancing: 'Fleet Rebalancing',
  submission_gap: 'Submission Gap',
  transfer_activity: 'Transfers',
  fleet_reliability: 'Fleet Reliability',
  site_performance: 'Site Rankings',
}

function formatRelativeDate(dateStr: string): string {
  const date = new Date(dateStr)
  const now = new Date()
  const diffMs = now.getTime() - date.getTime()
  const diffMins = Math.floor(diffMs / 60000)
  const diffHours = Math.floor(diffMs / 3600000)
  const diffDays = Math.floor(diffMs / 86400000)

  if (diffMins < 1) return 'just now'
  if (diffMins < 60) return `${diffMins}m ago`
  if (diffHours < 24) return `${diffHours}h ago`
  if (diffDays < 7) return `${diffDays}d ago`
  return date.toLocaleDateString('en-NG', { day: 'numeric', month: 'short' })
}

export function InsightCard({ insight, onAcknowledge, isAcknowledging }: InsightCardProps) {
  const [expanded, setExpanded] = useState(false)
  const config = SEVERITY_CONFIG[insight.severity]
  const Icon = config.icon

  const data = insight.data as Record<string, unknown>

  return (
    <Card className={`${config.border} border ${insight.acknowledged ? 'opacity-60' : ''}`}>
      <CardContent className="pt-4 pb-3">
        {/* Header row */}
        <div className="flex items-start gap-3">
          <div className={`mt-0.5 rounded-full p-1.5 ${config.bg}`}>
            <Icon className={`h-4 w-4 ${config.color}`} />
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap mb-1">
              <Badge variant={config.badge} className="text-[10px] px-1.5 py-0">
                {insight.severity}
              </Badge>
              <Badge variant="outline" className="text-[10px] px-1.5 py-0">
                {TYPE_LABELS[insight.insight_type] || insight.insight_type}
              </Badge>
              {insight.location_name && (
                <Link
                  href={`/locations/${insight.location_id}`}
                  className="flex items-center gap-0.5 text-[10px] text-muted-foreground hover:text-foreground"
                >
                  <MapPin className="h-3 w-3" />
                  {insight.location_name}
                </Link>
              )}
              <span className="flex items-center gap-0.5 text-[10px] text-muted-foreground ml-auto">
                <Clock className="h-3 w-3" />
                {formatRelativeDate(insight.created_at)}
              </span>
            </div>

            {/* Title */}
            <h3 className="text-sm font-semibold leading-tight mb-1">{insight.title}</h3>

            {/* Description */}
            <p className="text-xs text-muted-foreground leading-relaxed">{insight.description}</p>

            {/* Recommendation (expandable) */}
            {insight.recommendation && (
              <button
                onClick={() => setExpanded(!expanded)}
                className="flex items-center gap-1 mt-2 text-xs text-primary hover:underline"
              >
                {expanded ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
                {expanded ? 'Hide' : 'Show'} recommendation
              </button>
            )}
            {expanded && insight.recommendation && (
              <div className={`mt-2 p-2.5 rounded-md text-xs leading-relaxed ${config.bg}`}>
                {insight.recommendation}
              </div>
            )}

            {/* Supporting data preview */}
            {data && _renderDataPreview(insight)}

            {/* Actions */}
            {!insight.acknowledged && onAcknowledge && (
              <div className="mt-2.5 flex items-center gap-2">
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-7 text-xs"
                  onClick={() => onAcknowledge(insight.id)}
                  disabled={isAcknowledging}
                >
                  <Check className="h-3 w-3 mr-1" />
                  Acknowledge
                </Button>
              </div>
            )}
          </div>
        </div>
      </CardContent>
    </Card>
  )
}

function _renderDataPreview(insight: Insight) {
  const data = insight.data as Record<string, unknown>

  if (insight.insight_type === 'site_performance' && Array.isArray(data.rankings)) {
    const rankings = data.rankings as Array<{ rank: number; name: string; utilization_pct: number; total: number }>
    const top3 = rankings.slice(0, 3)
    const bottom3 = rankings.slice(-3).reverse()
    return (
      <div className="mt-2 grid grid-cols-2 gap-2">
        <div>
          <p className="text-[10px] font-medium text-emerald-600 mb-1">Top Performers</p>
          {top3.map((s) => (
            <div key={s.rank} className="flex justify-between text-[11px]">
              <span className="truncate">{s.name}</span>
              <span className="font-medium text-emerald-600">{s.utilization_pct}%</span>
            </div>
          ))}
        </div>
        <div>
          <p className="text-[10px] font-medium text-red-600 mb-1">Lowest Performers</p>
          {bottom3.map((s) => (
            <div key={s.rank} className="flex justify-between text-[11px]">
              <span className="truncate">{s.name}</span>
              <span className="font-medium text-red-600">{s.utilization_pct}%</span>
            </div>
          ))}
        </div>
      </div>
    )
  }

  if (insight.insight_type === 'fleet_reliability' && Array.isArray(data.high_breakdown_types)) {
    const types = (data.high_breakdown_types as Array<{ fleet_type: string; rate: number; total: number }>).slice(0, 5)
    return (
      <div className="mt-2">
        <p className="text-[10px] font-medium text-muted-foreground mb-1">High Breakdown Types</p>
        <div className="space-y-0.5">
          {types.map((t) => (
            <div key={t.fleet_type} className="flex items-center gap-2 text-[11px]">
              <span className="truncate flex-1">{t.fleet_type}</span>
              <div className="w-16 h-1.5 bg-muted rounded-full overflow-hidden">
                <div
                  className="h-full bg-red-500 rounded-full"
                  style={{ width: `${Math.min(t.rate, 100)}%` }}
                />
              </div>
              <span className="font-medium w-10 text-right">{t.rate}%</span>
            </div>
          ))}
        </div>
      </div>
    )
  }

  if (insight.insight_type === 'fleet_overview' && typeof data.total_plants === 'number') {
    const total = data.total_plants as number
    const segments = [
      { label: 'Working', count: data.working as number, color: 'bg-emerald-500' },
      { label: 'Standby', count: data.standby as number, color: 'bg-blue-400' },
      { label: 'Under Repair', count: data.under_repair as number, color: 'bg-amber-400' },
      { label: 'Breakdown/Faulty', count: data.breakdown_faulty as number, color: 'bg-red-500' },
      { label: 'Missing', count: data.missing as number, color: 'bg-purple-500' },
      { label: 'Scrap', count: data.scrap as number, color: 'bg-gray-400' },
    ]
    return (
      <div className="mt-2 space-y-1.5">
        <div className="flex h-2.5 rounded-full overflow-hidden bg-muted">
          {segments.map((s) =>
            s.count > 0 ? (
              <div
                key={s.label}
                className={s.color}
                style={{ width: `${(100 * s.count / total)}%` }}
                title={`${s.label}: ${s.count}`}
              />
            ) : null
          )}
        </div>
        <div className="flex flex-wrap gap-x-3 gap-y-0.5">
          {segments.map((s) =>
            s.count > 0 ? (
              <span key={s.label} className="flex items-center gap-1 text-[10px] text-muted-foreground">
                <span className={`inline-block w-2 h-2 rounded-full ${s.color}`} />
                {s.label}: {s.count.toLocaleString()}
              </span>
            ) : null
          )}
        </div>
      </div>
    )
  }

  if (insight.insight_type === 'utilization_alert' && typeof data.utilization_pct === 'number') {
    const pct = data.utilization_pct as number
    return (
      <div className="mt-2 flex items-center gap-3">
        <div className="flex-1 h-2 bg-muted rounded-full overflow-hidden">
          <div
            className={`h-full rounded-full ${pct < 30 ? 'bg-red-500' : pct < 60 ? 'bg-amber-500' : 'bg-emerald-500'}`}
            style={{ width: `${pct}%` }}
          />
        </div>
        <span className="text-xs font-medium">{pct}%</span>
      </div>
    )
  }

  return null
}
