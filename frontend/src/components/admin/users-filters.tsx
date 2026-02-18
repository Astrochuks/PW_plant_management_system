'use client'

import { Button } from '@/components/ui/button'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { X } from 'lucide-react'

interface UsersFiltersProps {
  role?: 'admin' | 'management'
  isActive?: boolean
  onRoleChange: (role: 'admin' | 'management' | undefined) => void
  onStatusChange: (status: boolean | undefined) => void
}

export function UsersFilters({
  role,
  isActive,
  onRoleChange,
  onStatusChange,
}: UsersFiltersProps) {
  const hasFilters = role !== undefined || isActive !== undefined

  return (
    <div className="flex gap-2 flex-wrap items-center">
      <Select value={role || 'all'} onValueChange={(v) => onRoleChange(v === 'all' ? undefined : (v as 'admin' | 'management'))}>
        <SelectTrigger className="w-40">
          <SelectValue placeholder="Filter by role" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="all">All Roles</SelectItem>
          <SelectItem value="admin">Admin</SelectItem>
          <SelectItem value="management">Management</SelectItem>
        </SelectContent>
      </Select>

      <Select
        value={isActive === undefined ? 'all' : String(isActive)}
        onValueChange={(v) => onStatusChange(v === 'all' ? undefined : v === 'true')}
      >
        <SelectTrigger className="w-40">
          <SelectValue placeholder="Filter by status" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="all">All Status</SelectItem>
          <SelectItem value="true">Active</SelectItem>
          <SelectItem value="false">Inactive</SelectItem>
        </SelectContent>
      </Select>

      {hasFilters && (
        <Button
          variant="ghost"
          size="sm"
          onClick={() => {
            onRoleChange(undefined)
            onStatusChange(undefined)
          }}
        >
          <X className="mr-1 h-4 w-4" />
          Clear
        </Button>
      )}
    </div>
  )
}
