'use client'

import { Search } from 'lucide-react'
import { Input } from '@/components/ui/input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import type { ProjectType, WorkNature } from '@/lib/api/projects'

interface ProjectsFiltersProps {
  search: string
  onSearchChange: (value: string) => void
  client: string
  onClientChange: (value: string) => void
  stateId: string
  onStateIdChange: (value: string) => void
  projectType: string
  onProjectTypeChange: (value: string) => void
  workNature: string
  onWorkNatureChange: (value: string) => void
  clients: string[]
  states: Array<{ id: string; name: string }>
}

const TYPE_OPTIONS: Array<{ value: ProjectType; label: string }> = [
  { value: 'road', label: 'Road' },
  { value: 'bridge', label: 'Bridge' },
  { value: 'drainage', label: 'Drainage' },
  { value: 'building', label: 'Building' },
  { value: 'airport', label: 'Airport' },
  { value: 'water', label: 'Water' },
  { value: 'infrastructure', label: 'Infrastructure' },
  { value: 'other', label: 'Other' },
]

const NATURE_OPTIONS: Array<{ value: WorkNature; label: string }> = [
  { value: 'construction', label: 'Construction' },
  { value: 'dualization', label: 'Dualization' },
  { value: 'rehabilitation', label: 'Rehabilitation' },
  { value: 'maintenance', label: 'Maintenance' },
  { value: 'emergency_repair', label: 'Emergency Repair' },
  { value: 'completion', label: 'Completion' },
]

export function ProjectsFilters({
  search,
  onSearchChange,
  client,
  onClientChange,
  stateId,
  onStateIdChange,
  projectType,
  onProjectTypeChange,
  workNature,
  onWorkNatureChange,
  clients,
  states,
}: ProjectsFiltersProps) {
  return (
    <div className="flex flex-col gap-3">
      {/* Search */}
      <div className="relative w-full lg:max-w-xl">
        <Search className="absolute left-3 top-3 h-4 w-4 text-muted-foreground" />
        <Input
          placeholder="Search projects..."
          value={search}
          onChange={(e) => onSearchChange(e.target.value)}
          className="pl-10"
        />
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-2 lg:grid-cols-4">
      {/* Client filter */}
      <Select value={client} onValueChange={onClientChange}>
        <SelectTrigger className="w-full">
          <SelectValue placeholder="All Clients" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="all">All Clients</SelectItem>
          {clients.map((c) => (
            <SelectItem key={c} value={c}>{c}</SelectItem>
          ))}
        </SelectContent>
      </Select>

      {/* State filter */}
      <Select value={stateId} onValueChange={onStateIdChange}>
        <SelectTrigger className="w-full">
          <SelectValue placeholder="All States" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="all">All States</SelectItem>
          {states.map((s) => (
            <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>
          ))}
        </SelectContent>
      </Select>

      {/* Type filter */}
      <Select value={projectType} onValueChange={onProjectTypeChange}>
        <SelectTrigger className="w-full">
          <SelectValue placeholder="All Types" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="all">All Types</SelectItem>
          {TYPE_OPTIONS.map((opt) => (
            <SelectItem key={opt.value} value={opt.value}>{opt.label}</SelectItem>
          ))}
        </SelectContent>
      </Select>

      {/* Work nature filter */}
      <Select value={workNature} onValueChange={onWorkNatureChange}>
        <SelectTrigger className="w-full">
          <SelectValue placeholder="All Work Types" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="all">All Work Types</SelectItem>
          {NATURE_OPTIONS.map((opt) => (
            <SelectItem key={opt.value} value={opt.value}>{opt.label}</SelectItem>
          ))}
        </SelectContent>
      </Select>
      </div>
    </div>
  )
}
