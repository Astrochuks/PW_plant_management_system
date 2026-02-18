'use client'

import { format } from 'date-fns'
import { Skeleton } from '@/components/ui/skeleton'
import { Badge } from '@/components/ui/badge'
import {
  AlertCircle,
  CheckCircle,
  MapPin,
  Wrench,
  Truck,
  Info,
  Clock,
  ArrowRight,
} from 'lucide-react'
import type { PlantEvent } from '@/lib/api/plants'

interface PlantEventsFeedProps {
  events: PlantEvent[]
  isLoading?: boolean
}

const EVENT_CONFIG: Record<string, {
  icon: React.ElementType
  label: string
  badgeClass: string
  borderClass: string
}> = {
  movement: {
    icon: MapPin,
    label: 'Movement',
    badgeClass: 'bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200',
    borderClass: 'border-l-blue-500',
  },
  missing: {
    icon: AlertCircle,
    label: 'Missing',
    badgeClass: 'bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200',
    borderClass: 'border-l-red-500',
  },
  new: {
    icon: Truck,
    label: 'New Plant',
    badgeClass: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900 dark:text-emerald-200',
    borderClass: 'border-l-emerald-500',
  },
  returned: {
    icon: CheckCircle,
    label: 'Returned',
    badgeClass: 'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200',
    borderClass: 'border-l-green-500',
  },
  verification_failed: {
    icon: AlertCircle,
    label: 'Verification Failed',
    badgeClass: 'bg-amber-100 text-amber-800 dark:bg-amber-900 dark:text-amber-200',
    borderClass: 'border-l-amber-500',
  },
  maintenance: {
    icon: Wrench,
    label: 'Maintenance',
    badgeClass: 'bg-purple-100 text-purple-800 dark:bg-purple-900 dark:text-purple-200',
    borderClass: 'border-l-purple-500',
  },
}

const DEFAULT_CONFIG = {
  icon: Info,
  label: 'Event',
  badgeClass: 'bg-muted text-muted-foreground',
  borderClass: 'border-l-muted-foreground',
}

/**
 * Deduplicate events that have the same type, date, and locations
 * (caused by re-processing the same weekly report).
 */
function deduplicateEvents(events: PlantEvent[]): PlantEvent[] {
  const seen = new Set<string>()
  return events.filter((event) => {
    const key = `${event.event_type}|${event.event_date}|${event.from_location_id}|${event.to_location_id}`
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}

function getEventDescription(event: PlantEvent): string | null {
  // Use remarks if available
  if (event.remarks) return event.remarks

  // Build description from event data
  if (event.event_type === 'movement') {
    const from = event.from_location_name
    const to = event.to_location_name
    if (from && to) return `Transferred from ${from} to ${to}`
    if (to) return `Transferred to ${to}`
    if (from) return `Transferred from ${from}`
    return 'Plant transferred'
  }

  if (event.event_type === 'missing') return 'Plant reported as missing'
  if (event.event_type === 'new') return 'New plant registered'
  if (event.event_type === 'returned') return 'Plant returned to inventory'
  if (event.event_type === 'verification_failed') return 'Physical verification failed'

  return null
}

export function PlantEventsFeed({ events, isLoading }: PlantEventsFeedProps) {
  if (isLoading) {
    return (
      <div className="space-y-3">
        {[1, 2, 3].map((i) => (
          <Skeleton key={i} className="h-20 w-full" />
        ))}
      </div>
    )
  }

  if (!events || events.length === 0) {
    return (
      <div className="text-center py-12">
        <Info className="h-10 w-10 mx-auto text-muted-foreground/50 mb-3" />
        <p className="font-medium">No events recorded</p>
        <p className="text-sm text-muted-foreground mt-1">
          Events will appear here when plant activity is detected.
        </p>
      </div>
    )
  }

  const uniqueEvents = deduplicateEvents(events)

  return (
    <div className="space-y-3">
      {uniqueEvents.map((event, index) => {
        const config = EVENT_CONFIG[event.event_type] || DEFAULT_CONFIG
        const Icon = config.icon
        const description = getEventDescription(event)

        return (
          <div
            key={event.id || index}
            className={`border rounded-lg border-l-4 ${config.borderClass} bg-card p-4`}
          >
            <div className="flex gap-3">
              <div className="flex-shrink-0 mt-0.5 text-muted-foreground">
                <Icon className="h-4 w-4" />
              </div>

              <div className="flex-1 min-w-0">
                <div className="flex items-start justify-between gap-2">
                  <div className="space-y-1">
                    <div className="flex items-center gap-2">
                      <Badge variant="secondary" className={`text-xs ${config.badgeClass}`}>
                        {config.label}
                      </Badge>
                      {event.week_number && (
                        <span className="text-xs text-muted-foreground">
                          Wk {event.week_number}{event.year ? `, ${event.year}` : ''}
                        </span>
                      )}
                    </div>

                    {description && (
                      <p className="text-sm text-foreground">{description}</p>
                    )}

                    {/* Movement locations */}
                    {event.event_type === 'movement' && (event.from_location_name || event.to_location_name) && (
                      <div className="flex items-center gap-2 text-xs text-muted-foreground">
                        <span>{event.from_location_name || '?'}</span>
                        <ArrowRight className="h-3 w-3" />
                        <span>{event.to_location_name || '?'}</span>
                      </div>
                    )}

                    {/* Acknowledged status */}
                    {event.acknowledged && (
                      <div className="flex items-center gap-1 text-xs text-emerald-600 dark:text-emerald-400">
                        <CheckCircle className="h-3 w-3" />
                        Acknowledged
                      </div>
                    )}
                  </div>

                  {/* Date */}
                  <div className="flex-shrink-0 text-right">
                    <div className="text-xs text-muted-foreground flex items-center gap-1 whitespace-nowrap">
                      <Clock className="h-3 w-3" />
                      {format(new Date(event.created_at), 'MMM d')}
                    </div>
                    <div className="text-xs text-muted-foreground">
                      {format(new Date(event.created_at), 'HH:mm')}
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        )
      })}
    </div>
  )
}
