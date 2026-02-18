'use client'

import { format } from 'date-fns'
import { Badge } from '@/components/ui/badge'
import { Skeleton } from '@/components/ui/skeleton'
import {
  AlertCircle,
  CheckCircle,
  MapPin,
  Wrench,
  Truck,
  Info,
  Clock,
} from 'lucide-react'

export interface PlantEvent {
  id: string
  event_type: string
  description: string
  details?: Record<string, any>
  created_at: string
}

interface PlantEventsFeedProps {
  events: PlantEvent[]
  isLoading?: boolean
}

function getEventIcon(eventType: string) {
  switch (eventType) {
    case 'transfer':
      return <MapPin className="h-4 w-4" />
    case 'maintenance':
      return <Wrench className="h-4 w-4" />
    case 'verification':
      return <CheckCircle className="h-4 w-4" />
    case 'damage':
      return <AlertCircle className="h-4 w-4" />
    case 'location_change':
      return <Truck className="h-4 w-4" />
    default:
      return <Info className="h-4 w-4" />
  }
}

function getEventColor(eventType: string) {
  switch (eventType) {
    case 'transfer':
      return 'bg-blue-50 border-blue-200'
    case 'maintenance':
      return 'bg-amber-50 border-amber-200'
    case 'verification':
      return 'bg-green-50 border-green-200'
    case 'damage':
      return 'bg-red-50 border-red-200'
    case 'location_change':
      return 'bg-purple-50 border-purple-200'
    default:
      return 'bg-gray-50 border-gray-200'
  }
}

export function PlantEventsFeed({ events, isLoading }: PlantEventsFeedProps) {
  if (isLoading) {
    return (
      <div className="space-y-4">
        {[1, 2, 3].map((i) => (
          <Skeleton key={i} className="h-20 w-full" />
        ))}
      </div>
    )
  }

  if (!events || events.length === 0) {
    return <div className="text-center py-8 text-muted-foreground">No events recorded</div>
  }

  return (
    <div className="space-y-3">
      {events.map((event, index) => (
        <div
          key={event.id || index}
          className={`border rounded-lg p-4 ${getEventColor(event.event_type)}`}
        >
          <div className="flex gap-3">
            {/* Icon */}
            <div className="flex-shrink-0 mt-1 text-muted-foreground">
              {getEventIcon(event.event_type)}
            </div>

            {/* Content */}
            <div className="flex-1 min-w-0">
              <div className="flex items-start justify-between gap-2">
                <div>
                  <h3 className="font-medium capitalize">{event.event_type}</h3>
                  <p className="text-sm text-muted-foreground mt-1">{event.description}</p>

                  {/* Details */}
                  {event.details && Object.keys(event.details).length > 0 && (
                    <div className="text-xs text-muted-foreground mt-2 space-y-1">
                      {Object.entries(event.details).map(([key, value]) => (
                        <div key={key}>
                          <strong>{key}:</strong> {String(value)}
                        </div>
                      ))}
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
      ))}
    </div>
  )
}
