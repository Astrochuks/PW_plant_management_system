'use client'

import { useState } from 'react'
import Link from 'next/link'
import { FolderKanban, Link2, Unlink, ChevronDown } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover'
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from '@/components/ui/command'
import { toast } from 'sonner'
import { useAuth } from '@/providers/auth-provider'
import { useUpdateLocation } from '@/hooks/use-locations'
import { useLinkableProjects } from '@/hooks/use-projects'
import type { LocationStats } from '@/lib/api/locations'

const STATUS_STYLES: Record<string, string> = {
  active: 'bg-emerald-100 text-emerald-700',
  completed: 'bg-gray-100 text-gray-700',
  retention_period: 'bg-amber-100 text-amber-700',
  on_hold: 'border text-foreground',
  cancelled: 'bg-red-100 text-red-700',
}

interface Props {
  location: LocationStats
}

export function LocationProjectLink({ location }: Props) {
  const { user } = useAuth()
  const isAdmin = user?.role === 'admin'
  const [open, setOpen] = useState(false)

  const hasLink = !!location.linked_project_id

  if (!hasLink && !isAdmin) return null

  return (
    <div className="rounded-lg border bg-card p-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="p-1.5 rounded-lg bg-primary/10">
            <FolderKanban className="h-4 w-4 text-primary" />
          </div>
          {hasLink ? (
            <div className="min-w-0">
              <Link
                href={`/projects/${location.linked_project_id}`}
                className="text-sm font-medium hover:underline line-clamp-1"
              >
                {location.linked_project_name}
              </Link>
              <div className="flex items-center gap-2 mt-0.5">
                <span className="text-xs text-muted-foreground">
                  {location.linked_project_client}
                </span>
                {location.linked_project_status && (
                  <Badge
                    variant="secondary"
                    className={`text-[10px] px-1.5 py-0 ${STATUS_STYLES[location.linked_project_status] ?? ''}`}
                  >
                    {location.linked_project_status.replace('_', ' ')}
                  </Badge>
                )}
              </div>
            </div>
          ) : (
            <span className="text-sm text-muted-foreground">No project linked</span>
          )}
        </div>

        {isAdmin && (
          hasLink ? (
            <UnlinkButton locationId={location.id} />
          ) : (
            <LinkProjectPopover
              locationId={location.id}
              open={open}
              onOpenChange={setOpen}
            />
          )
        )}
      </div>
    </div>
  )
}

function UnlinkButton({ locationId }: { locationId: string }) {
  const updateMutation = useUpdateLocation(locationId)

  const handleUnlink = async () => {
    try {
      await updateMutation.mutateAsync({ project_id: null })
      toast.success('Project unlinked')
    } catch {
      toast.error('Failed to unlink project')
    }
  }

  return (
    <Button
      variant="ghost"
      size="sm"
      className="text-xs text-muted-foreground"
      onClick={handleUnlink}
      disabled={updateMutation.isPending}
    >
      <Unlink className="h-3 w-3 mr-1" />
      Unlink
    </Button>
  )
}

function LinkProjectPopover({
  locationId,
  open,
  onOpenChange,
}: {
  locationId: string
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const { data: projects, isLoading } = useLinkableProjects()
  const updateMutation = useUpdateLocation(locationId)

  const handleSelect = async (projectId: string) => {
    try {
      await updateMutation.mutateAsync({ project_id: projectId })
      toast.success('Project linked')
      onOpenChange(false)
    } catch {
      toast.error('Failed to link project')
    }
  }

  return (
    <Popover open={open} onOpenChange={onOpenChange}>
      <PopoverTrigger asChild>
        <Button variant="outline" size="sm">
          <Link2 className="h-3.5 w-3.5 mr-2" />
          Link Project
          <ChevronDown className="h-3 w-3 ml-1 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="p-0 w-[320px]" align="end">
        <Command>
          <CommandInput placeholder="Search projects..." />
          <CommandList>
            <CommandEmpty>
              {isLoading ? 'Loading...' : 'No linkable projects found'}
            </CommandEmpty>
            <CommandGroup>
              {(projects ?? []).map((proj) => (
                <CommandItem
                  key={proj.id}
                  onSelect={() => handleSelect(proj.id)}
                >
                  <FolderKanban className="h-3.5 w-3.5 mr-2 text-muted-foreground" />
                  <div className="min-w-0 flex-1">
                    <span className="line-clamp-1 text-sm">{proj.project_name}</span>
                    <span className="text-xs text-muted-foreground">{proj.client}</span>
                  </div>
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  )
}
