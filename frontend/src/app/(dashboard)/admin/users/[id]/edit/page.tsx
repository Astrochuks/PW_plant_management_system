'use client'

import { useRouter, useParams } from 'next/navigation'
import Link from 'next/link'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { ProtectedRoute } from '@/components/protected-route'
import { UserForm } from '@/components/admin/user-form'
import { useUser } from '@/hooks/use-users'
import { ArrowLeft } from 'lucide-react'

function EditUserContent({ userId }: { userId: string }) {
  const router = useRouter()
  const { data: user, isLoading } = useUser(userId)

  if (isLoading) {
    return (
      <div className="space-y-6">
        <Skeleton className="h-8 w-32" />
        <Skeleton className="h-10 w-64" />
        <div className="space-y-4 max-w-3xl">
          <Skeleton className="h-12 w-full" />
          <Skeleton className="h-12 w-full" />
          <Skeleton className="h-12 w-full" />
          <Skeleton className="h-12 w-full" />
        </div>
      </div>
    )
  }

  if (!user) {
    return (
      <div className="space-y-6 text-center">
        <h1 className="text-3xl font-bold">User not found</h1>
        <Button asChild>
          <Link href="/admin/users">Back to Users</Link>
        </Button>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center gap-2">
        <Button variant="ghost" size="sm" asChild>
          <Link href="/admin/users">
            <ArrowLeft className="mr-1 h-4 w-4" />
            Back
          </Link>
        </Button>
      </div>

      <div>
        <h1 className="text-3xl font-bold tracking-tight">Edit User</h1>
        <p className="text-sm text-muted-foreground mt-1">Update user information</p>
      </div>

      {/* Form */}
      <div className="max-w-3xl bg-white dark:bg-slate-950 border border-border rounded-lg p-6">
        <UserForm
          user={user}
          onSuccess={() => router.push('/admin/users')}
          onCancel={() => router.push('/admin/users')}
        />
      </div>
    </div>
  )
}

export default function EditUserPage() {
  const params = useParams()
  const userId = params.id as string

  return (
    <ProtectedRoute requiredRole="admin">
      <EditUserContent userId={userId} />
    </ProtectedRoute>
  )
}
