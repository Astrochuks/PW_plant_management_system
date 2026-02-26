'use client'

import { CheckCircle, Circle, Clock, Minus } from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Skeleton } from '@/components/ui/skeleton'
import { useProjectMilestones } from '@/hooks/use-projects'
import type { Milestone } from '@/lib/api/projects'

interface Props {
  projectId: string
}

const STATUS_ICON = {
  completed: <CheckCircle className="h-4 w-4 text-emerald-500" />,
  upcoming: <Clock className="h-4 w-4 text-blue-500" />,
  not_set: <Circle className="h-4 w-4 text-muted-foreground/40" />,
}

function formatDate(dateStr: string) {
  return new Date(dateStr + 'T00:00:00').toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  })
}

export function ProjectMilestoneTimeline({ projectId }: Props) {
  const { data, isLoading } = useProjectMilestones(projectId)

  if (isLoading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-20 w-full" />
        <Skeleton className="h-[400px] w-full" />
      </div>
    )
  }

  if (!data) return null

  const { milestones, duration } = data
  const setMilestones = milestones.filter((m) => m.status !== 'not_set')
  const unsetMilestones = milestones.filter((m) => m.status === 'not_set')

  return (
    <div className="space-y-4">
      {/* Duration bar */}
      {duration.total_months != null && duration.total_months > 0 && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-medium">Project Duration</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex items-center gap-2 text-sm mb-2">
              {duration.original_months != null && (
                <Badge variant="secondary">{duration.original_months} months original</Badge>
              )}
              {duration.extension_months != null && duration.extension_months > 0 && (
                <Badge variant="outline">+{duration.extension_months} months extension</Badge>
              )}
              <span className="text-muted-foreground">
                = {duration.total_months} months total
              </span>
            </div>
            <div className="flex h-3 rounded-full overflow-hidden bg-muted">
              {duration.original_months != null && duration.total_months > 0 && (
                <div
                  className="bg-primary/70 h-full"
                  style={{
                    width: `${((duration.original_months || 0) / duration.total_months) * 100}%`,
                  }}
                />
              )}
              {duration.extension_months != null && duration.extension_months > 0 && (
                <div
                  className="bg-amber-400/70 h-full"
                  style={{
                    width: `${(duration.extension_months / duration.total_months) * 100}%`,
                  }}
                />
              )}
            </div>
            <div className="flex justify-between text-xs text-muted-foreground mt-1">
              <span>Original</span>
              {duration.extension_months != null && duration.extension_months > 0 && (
                <span>Extension of Time</span>
              )}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Timeline */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm font-medium">Milestones</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="relative">
            {/* Vertical line */}
            <div className="absolute left-[7px] top-2 bottom-2 w-px bg-border" />

            <div className="space-y-4">
              {/* Set milestones first */}
              {setMilestones.map((milestone) => (
                <MilestoneItem key={milestone.key} milestone={milestone} />
              ))}

              {/* Separator if both sections exist */}
              {setMilestones.length > 0 && unsetMilestones.length > 0 && (
                <div className="pl-8 py-1">
                  <div className="flex items-center gap-2">
                    <Minus className="h-3 w-3 text-muted-foreground/40" />
                    <span className="text-xs text-muted-foreground">Pending milestones</span>
                  </div>
                </div>
              )}

              {/* Unset milestones */}
              {unsetMilestones.map((milestone) => (
                <MilestoneItem key={milestone.key} milestone={milestone} />
              ))}
            </div>
          </div>

          {milestones.every((m) => m.status === 'not_set') && (
            <p className="text-sm text-muted-foreground text-center py-4">
              No milestone dates recorded yet
            </p>
          )}
        </CardContent>
      </Card>
    </div>
  )
}

function MilestoneItem({ milestone }: { milestone: Milestone }) {
  return (
    <div className="flex items-start gap-3 relative">
      <div className="relative z-10 mt-0.5 bg-background p-0.5">
        {STATUS_ICON[milestone.status]}
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center justify-between gap-2">
          <span
            className={`text-sm font-medium ${
              milestone.status === 'not_set' ? 'text-muted-foreground/60' : ''
            }`}
          >
            {milestone.label}
          </span>
          {milestone.date ? (
            <span
              className={`text-sm tabular-nums ${
                milestone.status === 'completed'
                  ? 'text-emerald-600 font-medium'
                  : 'text-blue-600'
              }`}
            >
              {formatDate(milestone.date)}
            </span>
          ) : (
            <span className="text-xs text-muted-foreground/50">Not set</span>
          )}
        </div>
      </div>
    </div>
  )
}
