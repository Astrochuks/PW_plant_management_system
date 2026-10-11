'use client'

/**
 * The project manager's picker (PRD v2 §2): "All sites" or one project.
 * A quick way to move between the portfolio and a project — and it only
 * ever narrows what the API already allows: a project-scoped PM's list
 * contains only their assignments. The value is derived from the URL, so
 * the picker always shows where you are.
 */

import { usePathname, useRouter } from 'next/navigation'
import { FolderKanban } from 'lucide-react'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { useProjects } from '@/hooks/use-projects'

const ALL = '__all__'

export function ProjectFocusPicker() {
  const router = useRouter()
  const pathname = usePathname()
  const { data } = useProjects({ is_legacy: false, limit: 100, sort_by: 'project_name', sort_order: 'asc' })
  const projects = data?.data ?? []
  const inUrl = pathname.match(/^\/projects\/([0-9a-f-]{36})/)?.[1]
  const value = inUrl && projects.some((p) => p.id === inUrl) ? inUrl : ALL

  return (
    <Select value={value} onValueChange={(v) => router.push(v === ALL ? '/projects/ongoing' : `/projects/${v}`)}>
      <SelectTrigger className="h-8 w-[260px] text-sm">
        <FolderKanban className="mr-2 h-4 w-4 text-muted-foreground" />
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value={ALL}>All sites</SelectItem>
        {projects.map((p) => (
          <SelectItem key={p.id} value={p.id}>{p.short_name || p.project_name}</SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}
