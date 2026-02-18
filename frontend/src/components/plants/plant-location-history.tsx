'use client'

import { format } from 'date-fns'
import { MapPin, Calendar } from 'lucide-react'
import { Skeleton } from '@/components/ui/skeleton'

export interface LocationRecord {
  location_name: string
  start_date: string
  end_date?: string
  duration_days?: number
  transfer_reason?: string
}

interface PlantLocationHistoryProps {
  records: LocationRecord[]
  isLoading?: boolean
}

export function PlantLocationHistory({ records, isLoading }: PlantLocationHistoryProps) {
  if (isLoading) {
    return (
      <div className="space-y-4">
        {[1, 2, 3].map((i) => (
          <Skeleton key={i} className="h-24 w-full" />
        ))}
      </div>
    )
  }

  if (!records || records.length === 0) {
    return <div className="text-center py-8 text-muted-foreground">No site history</div>
  }

  return (
    <div className="space-y-0">
      {records.map((record, index) => (
        <div key={index} className="border-l-2 border-gold pl-4 pb-8 relative">
          {/* Timeline dot */}
          <div className="absolute left-[-8px] top-0 w-4 h-4 bg-gold rounded-full border-4 border-background" />

          {/* Content */}
          <div className="space-y-2">
            <div className="flex items-center gap-2">
              <MapPin className="h-4 w-4 text-muted-foreground" />
              <h3 className="font-semibold text-lg">{record.location_name}</h3>
            </div>

            <div className="text-sm space-y-1 text-muted-foreground ml-6">
              <div className="flex items-center gap-2">
                <Calendar className="h-3 w-3" />
                <span>
                  From: {format(new Date(record.start_date), 'MMM d, yyyy')}
                </span>
              </div>

              {record.end_date && (
                <div className="flex items-center gap-2">
                  <Calendar className="h-3 w-3" />
                  <span>
                    To: {format(new Date(record.end_date), 'MMM d, yyyy')}
                  </span>
                </div>
              )}

              {record.duration_days && (
                <div className="text-xs">
                  Duration: {record.duration_days} days
                </div>
              )}

              {record.transfer_reason && (
                <div className="mt-2 text-xs italic bg-muted p-2 rounded">
                  Reason: {record.transfer_reason}
                </div>
              )}
            </div>
          </div>
        </div>
      ))}
    </div>
  )
}
