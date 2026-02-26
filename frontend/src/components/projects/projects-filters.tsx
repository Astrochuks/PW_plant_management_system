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
import type { ProjectStatus } from '@/lib/api/projects'

interface ProjectsFiltersProps {
  search: string
  onSearchChange: (value: string) => void
  client: string
  onClientChange: (value: string) => void
  status: string
  onStatusChange: (value: string) => void
  stateId: string
  onStateIdChange: (value: string) => void
  clients: string[]
  states: Array<{ id: string; name: string }>
}

const STATUS_OPTIONS: Array<{ value: ProjectStatus | ''; label: string }> = [
  { value: '', label: 'All Statuses' },
  { value: 'active', label: 'Active' },
  { value: 'completed', label: 'Completed' },
  { value: 'retention_period', label: 'Retention Period' },
  { value: 'on_hold', label: 'On Hold' },
  { value: 'cancelled', label: 'Cancelled' },
]

export function ProjectsFilters({
  search,
  onSearchChange,
  client,
  onClientChange,
  status,
  onStatusChange,
  stateId,
  onStateIdChange,
  clients,
  states,
}: ProjectsFiltersProps) {
  return (
    <div className="flex flex-col sm:flex-row gap-3">
      {/* Search */}
      <div className="relative flex-1">
        <Search className="absolute left-3 top-3 h-4 w-4 text-muted-foreground" />
        <Input
          placeholder="Search projects..."
          value={search}
          onChange={(e) => onSearchChange(e.target.value)}
          className="pl-10"
        />
      </div>

      {/* Client filter */}
      <Select value={client} onValueChange={onClientChange}>
        <SelectTrigger className="w-full sm:w-[180px]">
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
        <SelectTrigger className="w-full sm:w-[160px]">
          <SelectValue placeholder="All States" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="all">All States</SelectItem>
          {states.map((s) => (
            <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>
          ))}
        </SelectContent>
      </Select>

      {/* Status filter */}
      <Select value={status} onValueChange={onStatusChange}>
        <SelectTrigger className="w-full sm:w-[160px]">
          <SelectValue placeholder="All Statuses" />
        </SelectTrigger>
        <SelectContent>
          {STATUS_OPTIONS.map((opt) => (
            <SelectItem key={opt.value || 'all'} value={opt.value || 'all'}>
              {opt.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  )
}
