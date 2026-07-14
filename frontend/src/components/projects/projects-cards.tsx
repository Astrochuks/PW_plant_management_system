'use client'

import { useRouter } from 'next/navigation'
import { FolderKanban, MapPin, Building2, CalendarDays } from 'lucide-react'
import { Card, CardContent } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Skeleton } from '@/components/ui/skeleton'
import { STATUS_STYLES } from './projects-table'
import type { Project } from '@/hooks/use-projects'

interface ProjectsCardsProps {
  projects: Project[]
  isLoading: boolean
  onPrefetch?: (id: string) => void
}

function formatCurrency(amount: number): string {
  return new Intl.NumberFormat('en-NG', {
    style: 'currency',
    currency: 'NGN',
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(amount)
}

function formatDate(dateStr: string): string {
  return new Date(dateStr + 'T00:00:00').toLocaleDateString('en-GB', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  })
}

export function ProjectsCards({ projects, isLoading, onPrefetch }: ProjectsCardsProps) {
  const router = useRouter()

  if (isLoading) {
    return (
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
        {[...Array(6)].map((_, i) => (
          <Card key={i}>
            <CardContent className="space-y-3 p-5">
              <div className="flex justify-between">
                <Skeleton className="h-5 w-16" />
                <Skeleton className="h-5 w-14" />
              </div>
              <Skeleton className="h-5 w-3/4" />
              <Skeleton className="h-4 w-full" />
              <Skeleton className="h-4 w-2/3" />
              <Skeleton className="h-6 w-1/2" />
            </CardContent>
          </Card>
        ))}
      </div>
    )
  }

  if (projects.length === 0) {
    return (
      <div className="text-center py-12 text-muted-foreground border rounded-lg">
        <FolderKanban className="h-12 w-12 mx-auto mb-4 opacity-50" />
        <p className="text-lg">No projects found</p>
        <p className="text-sm mt-1">Try adjusting your filters or search term</p>
      </div>
    )
  }

  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
      {projects.map((p) => {
        const status = STATUS_STYLES[p.status] || STATUS_STYLES.active
        return (
          <Card
            key={p.id}
            role="link"
            tabIndex={0}
            className="group cursor-pointer transition-all duration-200 hover:-translate-y-0.5 hover:border-primary/50 hover:shadow-lg focus-visible:ring-2 focus-visible:ring-ring"
            onClick={() => router.push(`/projects/${p.id}`)}
            onKeyDown={(e) => e.key === 'Enter' && router.push(`/projects/${p.id}`)}
            onMouseEnter={() => onPrefetch?.(p.id)}
          >
            <CardContent className="flex h-full flex-col gap-3 p-5">
              <div className="flex items-start justify-between gap-2">
                <Badge variant={status.variant} className={status.className}>
                  {status.label}
                </Badge>
                {p.project_type && (
                  <Badge variant="outline" className="capitalize">
                    {p.project_type}
                    {p.work_nature && (
                      <span className="ml-1 font-normal text-muted-foreground capitalize">
                        · {p.work_nature.replace('_', ' ')}
                      </span>
                    )}
                  </Badge>
                )}
              </div>

              <div>
                <h3 className="font-semibold leading-snug group-hover:text-primary transition-colors">
                  {p.short_name || p.project_name}
                </h3>
                {p.short_name && (
                  <p className="mt-1 text-xs text-muted-foreground line-clamp-2">
                    {p.project_name}
                  </p>
                )}
              </div>

              <div className="space-y-1.5 text-sm text-muted-foreground">
                <p className="flex items-center gap-2 truncate">
                  <Building2 className="h-3.5 w-3.5 shrink-0" />
                  <span className="truncate">{p.client}</span>
                </p>
                <p className="flex items-center gap-2">
                  <MapPin className="h-3.5 w-3.5 shrink-0" />
                  {p.state_name || '—'}
                </p>
              </div>

              <div className="mt-auto flex items-end justify-between border-t pt-3">
                <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
                  <CalendarDays className="h-3.5 w-3.5" />
                  {p.award_date ? formatDate(p.award_date) : 'No award date'}
                </p>
                <p className="font-semibold tabular-nums">
                  {p.current_contract_sum != null ? formatCurrency(p.current_contract_sum) : '—'}
                </p>
              </div>
            </CardContent>
          </Card>
        )
      })}
    </div>
  )
}
