'use client'

import { useState } from 'react'
import Link from 'next/link'
import { Button } from '@/components/ui/button'
import { ProtectedRoute } from '@/components/protected-route'
import { UsersTable } from '@/components/admin/users-table'
import { UsersFilters } from '@/components/admin/users-filters'
import { useUsers } from '@/hooks/use-users'
import { Plus } from 'lucide-react'

function UsersPageContent() {
  const [filters, setFilters] = useState<{ role?: 'admin' | 'management' | 'site_engineer'; is_active?: boolean }>({})
  const { data: users, isLoading } = useUsers(filters)

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex justify-between items-center">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Users</h1>
          <p className="text-sm text-muted-foreground mt-1">Manage system users and permissions</p>
        </div>
        <Button asChild>
          <Link href="/admin/users/create">
            <Plus className="mr-2 h-4 w-4" />
            Create User
          </Link>
        </Button>
      </div>

      {/* Filters */}
      <div className="bg-white dark:bg-slate-950 border border-border rounded-lg p-4">
        <UsersFilters
          role={filters.role}
          isActive={filters.is_active}
          onRoleChange={(role) => setFilters((prev) => ({ ...prev, role: role as typeof prev.role }))}
          onStatusChange={(is_active) => setFilters((prev) => ({ ...prev, is_active }))}
        />
      </div>

      {/* Table */}
      <div className="bg-white dark:bg-slate-950 border border-border rounded-lg overflow-hidden">
        <UsersTable users={users || []} isLoading={isLoading} />
      </div>
    </div>
  )
}

export default function UsersPage() {
  return (
    <ProtectedRoute requiredRole="admin">
      <UsersPageContent />
    </ProtectedRoute>
  )
}
