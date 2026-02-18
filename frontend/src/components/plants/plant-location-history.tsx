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

/**
 * Merge consecutive records for the same location into a single entry.
 * Keeps the earliest start_date and the latest end_date.
 */
function mergeConsecutiveLocations(records: LocationRecord[]): LocationRecord[] {
  if (records.length <= 1) return records

  const merged: LocationRecord[] = []

  for (const record of records) {
    const prev = merged[merged.length - 1]
    if (
      prev &&
      prev.location_name === record.location_name
    ) {
      // Extend the previous entry: take earliest start, latest end
      if (record.start_date < prev.start_date) {
        prev.start_date = record.start_date
      }
      if (record.end_date && prev.end_date) {
        if (record.end_date > prev.end_date) {
          prev.end_date = record.end_date
        }
      } else if (!record.end_date) {
        // Current location (no end_date) wins
        prev.end_date = undefined
      }
      // Recalculate duration
      if (prev.end_date) {
        const start = new Date(prev.start_date)
        const end = new Date(prev.end_date)
        prev.duration_days = Math.ceil((end.getTime() - start.getTime()) / (1000 * 60 * 60 * 24))
      } else {
        const start = new Date(prev.start_date)
        prev.duration_days = Math.ceil((Date.now() - start.getTime()) / (1000 * 60 * 60 * 24))
      }
    } else {
      merged.push({ ...record })
    }
  }

  return merged
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
    return (
      <div className="text-center py-12">
        <MapPin className="h-10 w-10 mx-auto text-muted-foreground/50 mb-3" />
        <p className="font-medium">No site history</p>
        <p className="text-sm text-muted-foreground mt-1">
          Location history will appear as the plant moves between sites.
        </p>
      </div>
    )
  }

  const mergedRecords = mergeConsecutiveLocations(records)

  return (
    <div className="space-y-0">
      {mergedRecords.map((record, index) => {
        const isCurrent = !record.end_date
        return (
          <div key={index} className="border-l-2 border-border pl-4 pb-8 relative last:pb-0">
            {/* Timeline dot */}
            <div
              className={`absolute left-[-8px] top-0 w-4 h-4 rounded-full border-4 border-background ${
                isCurrent ? 'bg-primary' : 'bg-muted-foreground'
              }`}
            />

            <div className="space-y-2">
              <div className="flex items-center gap-2">
                <MapPin className="h-4 w-4 text-muted-foreground" />
                <h3 className="font-semibold text-lg">{record.location_name}</h3>
                {isCurrent && (
                  <span className="text-xs bg-primary/10 text-primary px-2 py-0.5 rounded-full font-medium">
                    Current
                  </span>
                )}
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

                {record.duration_days != null && record.duration_days > 0 && (
                  <div className="text-xs">
                    Duration: {record.duration_days} day{record.duration_days !== 1 ? 's' : ''}
                  </div>
                )}

                {record.transfer_reason && record.transfer_reason !== 'Weekly report update' && (
                  <div className="mt-2 text-xs italic bg-muted p-2 rounded">
                    Reason: {record.transfer_reason}
                  </div>
                )}
              </div>
            </div>
          </div>
        )
      })}
    </div>
  )
}
