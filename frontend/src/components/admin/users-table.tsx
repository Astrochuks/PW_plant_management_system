'use client'

import Link from 'next/link'
import { Button } from '@/components/ui/button'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { Badge } from '@/components/ui/badge'
import { Edit, Trash2, Key, MoreHorizontal } from 'lucide-react'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { useDeactivateUser, useResetUserPassword } from '@/hooks/use-users'
import { toast } from 'sonner'
import { useState } from 'react'
import type { User } from '@/lib/api/admin'

// Format date in user's local timezone
function formatDateTime(dateString: string): string {
  const date = new Date(dateString)
  return date.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  })
}

function formatDate(dateString: string): string {
  const date = new Date(dateString)
  return date.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  })
}

interface UsersTableProps {
  users: User[]
  isLoading?: boolean
}

export function UsersTable({ users, isLoading }: UsersTableProps) {
  const [confirmAction, setConfirmAction] = useState<{
    type: 'deactivate' | 'reset-password'
    userId: string
    email: string
  } | null>(null)

  const deactivateMutation = useDeactivateUser()
  const resetPasswordMutation = useResetUserPassword()

  const handleDeactivate = async () => {
    if (!confirmAction || confirmAction.type !== 'deactivate') return

    try {
      await deactivateMutation.mutateAsync(confirmAction.userId)
      toast.success(`User ${confirmAction.email} deactivated`)
      setConfirmAction(null)
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to deactivate user'
      toast.error(message)
    }
  }

  const handleResetPassword = async () => {
    if (!confirmAction || confirmAction.type !== 'reset-password') return

    try {
      await resetPasswordMutation.mutateAsync(confirmAction.userId)
      toast.success(`Password reset link sent to ${confirmAction.email}`)
      setConfirmAction(null)
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to reset password'
      toast.error(message)
    }
  }

  if (isLoading) {
    return <div className="text-center py-8 text-muted-foreground">Loading users...</div>
  }

  if (!users || users.length === 0) {
    return <div className="text-center py-8 text-muted-foreground">No users found</div>
  }

  return (
    <>
      <div className="border rounded-lg overflow-hidden">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Email</TableHead>
              <TableHead>Full Name</TableHead>
              <TableHead>Role</TableHead>
              <TableHead>Site</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Last Login</TableHead>
              <TableHead>Created</TableHead>
              <TableHead className="text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {users.map((user) => (
              <TableRow key={user.id}>
                <TableCell className="font-medium">{user.email}</TableCell>
                <TableCell>{user.full_name}</TableCell>
                <TableCell>
                  <Badge
                    variant={
                      user.role === 'admin' ? 'default'
                      : user.role === 'site_engineer' ? 'outline'
                      : 'secondary'
                    }
                    className={user.role === 'site_engineer' ? 'bg-blue-50 text-blue-700 border-blue-200' : ''}
                  >
                    {user.role === 'site_engineer' ? 'Site Engineer' : user.role}
                  </Badge>
                </TableCell>
                <TableCell className="text-sm text-muted-foreground">
                  {user.role === 'site_engineer'
                    ? (user.location_name ?? <span className="italic">Not assigned</span>)
                    : <span className="text-muted-foreground/40">—</span>}
                </TableCell>
                <TableCell>
                  {user.is_active ? (
                    <Badge variant="outline" className="bg-emerald-100 text-emerald-800 border-emerald-200 dark:bg-emerald-900 dark:text-emerald-200 dark:border-emerald-800">
                      Active
                    </Badge>
                  ) : (
                    <Badge variant="destructive">Inactive</Badge>
                  )}
                </TableCell>
                <TableCell className="text-sm">
                  {user.last_login_at
                    ? formatDateTime(user.last_login_at)
                    : 'Never'}
                </TableCell>
                <TableCell className="text-sm">
                  {formatDate(user.created_at)}
                </TableCell>
                <TableCell className="text-right">
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button variant="ghost" size="sm">
                        <MoreHorizontal className="h-4 w-4" />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      <DropdownMenuItem asChild>
                        <Link href={`/admin/users/${user.id}/edit`} className="cursor-pointer">
                          <Edit className="mr-2 h-4 w-4" />
                          Edit
                        </Link>
                      </DropdownMenuItem>
                      <DropdownMenuItem
                        onClick={() =>
                          setConfirmAction({
                            type: 'reset-password',
                            userId: user.id,
                            email: user.email,
                          })
                        }
                      >
                        <Key className="mr-2 h-4 w-4" />
                        Reset Password
                      </DropdownMenuItem>
                      <DropdownMenuItem
                        onClick={() =>
                          setConfirmAction({
                            type: 'deactivate',
                            userId: user.id,
                            email: user.email,
                          })
                        }
                        className="text-destructive focus:text-destructive"
                      >
                        <Trash2 className="mr-2 h-4 w-4" />
                        {user.is_active ? 'Deactivate' : 'Already Inactive'}
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      <AlertDialog open={!!confirmAction} onOpenChange={() => setConfirmAction(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {confirmAction?.type === 'deactivate' ? 'Deactivate User' : 'Reset Password'}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {confirmAction?.type === 'deactivate'
                ? `Are you sure you want to deactivate ${confirmAction?.email}? They won't be able to log in.`
                : `Are you sure you want to reset the password for ${confirmAction?.email}? They will receive a reset link via email.`}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogAction
            onClick={
              confirmAction?.type === 'deactivate' ? handleDeactivate : handleResetPassword
            }
            className={confirmAction?.type === 'deactivate' ? 'bg-destructive' : ''}
            disabled={
              deactivateMutation.isPending ||
              resetPasswordMutation.isPending
            }
          >
            {confirmAction?.type === 'deactivate' ? 'Deactivate' : 'Reset Password'}
          </AlertDialogAction>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}
