'use client'

import { useState } from 'react'
import Link from 'next/link'
import { MapPin, Link2, Unlink, ChevronDown } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
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
import { useUnlinkedLocations, useUpdateLocation } from '@/hooks/use-locations'
import type { Project } from '@/lib/api/projects'

interface Props {
  project: Project
}

export function ProjectLocationLink({ project }: Props) {
  const { user } = useAuth()
  const isAdmin = user?.role === 'admin'
  const [open, setOpen] = useState(false)

  const hasLink = !!project.linked_location_id

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm font-medium flex items-center gap-2">
          <MapPin className="h-4 w-4" />
          Linked Site
        </CardTitle>
      </CardHeader>
      <CardContent>
        {hasLink ? (
          <div className="space-y-2">
            <Link
              href={`/locations/${project.linked_location_id}`}
              className="text-sm font-medium text-primary hover:underline"
            >
              {project.linked_location_name}
            </Link>
            {isAdmin && (
              <UnlinkButton
                locationId={project.linked_location_id!}
                locationName={project.linked_location_name!}
              />
            )}
          </div>
        ) : (
          <div className="space-y-2">
            <p className="text-sm text-muted-foreground">No site linked</p>
            {isAdmin && (
              <LinkSitePopover
                projectId={project.id}
                open={open}
                onOpenChange={setOpen}
              />
            )}
          </div>
        )}
      </CardContent>
    </Card>
  )
}

function UnlinkButton({ locationId, locationName }: { locationId: string; locationName: string }) {
  const updateMutation = useUpdateLocation(locationId)

  const handleUnlink = async () => {
    try {
      await updateMutation.mutateAsync({ project_id: null })
      toast.success(`Unlinked from ${locationName}`)
    } catch {
      toast.error('Failed to unlink site')
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

function LinkSitePopover({
  projectId,
  open,
  onOpenChange,
}: {
  projectId: string
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const { data: locations, isLoading } = useUnlinkedLocations()

  return (
    <Popover open={open} onOpenChange={onOpenChange}>
      <PopoverTrigger asChild>
        <Button variant="outline" size="sm" className="w-full">
          <Link2 className="h-3.5 w-3.5 mr-2" />
          Link Site
          <ChevronDown className="h-3 w-3 ml-auto opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="p-0 w-[280px]" align="start">
        <Command>
          <CommandInput placeholder="Search sites..." />
          <CommandList>
            <CommandEmpty>
              {isLoading ? 'Loading...' : 'No unlinked sites found'}
            </CommandEmpty>
            <CommandGroup>
              {(locations ?? []).map((loc) => (
                <LinkSiteItem
                  key={loc.id}
                  locationId={loc.id}
                  locationName={loc.name}
                  state={loc.state}
                  projectId={projectId}
                  onDone={() => onOpenChange(false)}
                />
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  )
}

function LinkSiteItem({
  locationId,
  locationName,
  state,
  projectId,
  onDone,
}: {
  locationId: string
  locationName: string
  state: string | null
  projectId: string
  onDone: () => void
}) {
  const updateMutation = useUpdateLocation(locationId)

  const handleSelect = async () => {
    try {
      await updateMutation.mutateAsync({ project_id: projectId })
      toast.success(`Linked to ${locationName}`)
      onDone()
    } catch {
      toast.error('Failed to link site')
    }
  }

  return (
    <CommandItem onSelect={handleSelect}>
      <MapPin className="h-3.5 w-3.5 mr-2 text-muted-foreground" />
      <span>{locationName}</span>
      {state && (
        <span className="ml-auto text-xs text-muted-foreground">{state}</span>
      )}
    </CommandItem>
  )
}
