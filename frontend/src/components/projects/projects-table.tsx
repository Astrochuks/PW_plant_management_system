'use client'

import { useRouter } from 'next/navigation'
import { FolderKanban } from 'lucide-react'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { Badge } from '@/components/ui/badge'
import { Skeleton } from '@/components/ui/skeleton'
import type { Project } from '@/hooks/use-projects'

interface ProjectsTableProps {
  projects: Project[]
  isLoading: boolean
  onPrefetch?: (id: string) => void
}

const STATUS_STYLES: Record<string, { label: string; variant: 'default' | 'secondary' | 'destructive' | 'outline'; className?: string }> = {
  active: { label: 'Active', variant: 'default', className: 'bg-emerald-600 hover:bg-emerald-600 text-white' },
  completed: { label: 'Completed', variant: 'secondary', className: 'bg-gray-200 text-gray-700' },
  retention_period: { label: 'Retention', variant: 'secondary', className: 'bg-amber-100 text-amber-800' },
  on_hold: { label: 'On Hold', variant: 'outline' },
  cancelled: { label: 'Cancelled', variant: 'destructive' },
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
  return new Date(dateStr).toLocaleDateString('en-NG', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  })
}

export function ProjectsTable({ projects, isLoading, onPrefetch }: ProjectsTableProps) {
  const router = useRouter()

  if (isLoading) {
    return <ProjectsTableSkeleton />
  }

  if (projects.length === 0) {
    return (
      <div className="text-center py-12 text-muted-foreground">
        <FolderKanban className="h-12 w-12 mx-auto mb-4 opacity-50" />
        <p className="text-lg">No projects found</p>
        <p className="text-sm mt-1">Try adjusting your filters or search term</p>
      </div>
    )
  }

  return (
    <div className="rounded-md border">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Project Name</TableHead>
            <TableHead className="w-[150px]">Client</TableHead>
            <TableHead className="w-[120px]">State</TableHead>
            <TableHead className="w-[130px]">Site</TableHead>
            <TableHead className="w-[110px]">Status</TableHead>
            <TableHead className="w-[150px] text-right">Contract Sum</TableHead>
            <TableHead className="w-[110px]">Award Date</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {projects.map((project) => {
            const style = STATUS_STYLES[project.status] || STATUS_STYLES.active
            return (
              <TableRow
                key={project.id}
                className={`cursor-pointer hover:bg-muted/50 ${project.is_legacy ? 'opacity-60' : ''}`}
                onClick={() => router.push(`/projects/${project.id}`)}
                onMouseEnter={() => onPrefetch?.(project.id)}
              >
                <TableCell>
                  <div className="flex items-center gap-2">
                    <span className="font-medium">{project.project_name}</span>
                    {project.is_legacy && (
                      <Badge variant="outline" className="text-[10px] px-1.5 py-0 text-muted-foreground">
                        Legacy
                      </Badge>
                    )}
                  </div>
                  {project.short_name && (
                    <div className="text-xs text-muted-foreground">{project.short_name}</div>
                  )}
                </TableCell>
                <TableCell className="text-sm">{project.client}</TableCell>
                <TableCell className="text-sm">{project.state_name || '-'}</TableCell>
                <TableCell className="text-sm">
                  {project.linked_location_name || (
                    <span className="text-muted-foreground">-</span>
                  )}
                </TableCell>
                <TableCell>
                  <Badge variant={style.variant} className={style.className}>
                    {style.label}
                  </Badge>
                </TableCell>
                <TableCell className="text-right font-medium">
                  {project.current_contract_sum != null
                    ? formatCurrency(project.current_contract_sum)
                    : '-'}
                </TableCell>
                <TableCell className="text-sm">
                  {project.award_date ? formatDate(project.award_date) : '-'}
                </TableCell>
              </TableRow>
            )
          })}
        </TableBody>
      </Table>
    </div>
  )
}

function ProjectsTableSkeleton() {
  return (
    <div className="rounded-md border">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Project Name</TableHead>
            <TableHead className="w-[150px]">Client</TableHead>
            <TableHead className="w-[120px]">State</TableHead>
            <TableHead className="w-[130px]">Site</TableHead>
            <TableHead className="w-[110px]">Status</TableHead>
            <TableHead className="w-[150px] text-right">Contract Sum</TableHead>
            <TableHead className="w-[110px]">Award Date</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {[...Array(8)].map((_, i) => (
            <TableRow key={i}>
              <TableCell><Skeleton className="h-5 w-full max-w-[300px]" /></TableCell>
              <TableCell><Skeleton className="h-5 w-24" /></TableCell>
              <TableCell><Skeleton className="h-5 w-20" /></TableCell>
              <TableCell><Skeleton className="h-5 w-24" /></TableCell>
              <TableCell><Skeleton className="h-5 w-16" /></TableCell>
              <TableCell><Skeleton className="h-5 w-28 ml-auto" /></TableCell>
              <TableCell><Skeleton className="h-5 w-20" /></TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  )
}
