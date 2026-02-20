'use client'

import { useState } from 'react'
import Link from 'next/link'
import { Map, Plus, Pencil, Trash2 } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { Switch } from '@/components/ui/switch'
import { Label } from '@/components/ui/label'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog'
import { ProtectedRoute } from '@/components/protected-route'
import { useStatesAdmin, useDeleteState } from '@/hooks/use-states'
import { getErrorMessage } from '@/lib/api/client'

function StatesPageContent() {
  const [showInactive, setShowInactive] = useState(false)
  const { data: states, isLoading } = useStatesAdmin(showInactive)
  const deleteMutation = useDeleteState()

  const handleDelete = async (id: string, name: string) => {
    try {
      await deleteMutation.mutateAsync(id)
      toast.success(`State "${name}" deleted`)
    } catch (error) {
      toast.error(getErrorMessage(error))
    }
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
            <Map className="h-6 w-6" />
            States
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            Manage Nigerian states for site grouping
          </p>
        </div>
        <Button asChild>
          <Link href="/admin/states/create">
            <Plus className="h-4 w-4 mr-2" />
            Add State
          </Link>
        </Button>
      </div>

      {/* Filters */}
      <div className="flex items-center gap-3">
        <Switch
          id="show-inactive"
          checked={showInactive}
          onCheckedChange={setShowInactive}
        />
        <Label htmlFor="show-inactive" className="text-sm">
          Show inactive states
        </Label>
      </div>

      {/* Table */}
      {isLoading ? (
        <Skeleton className="h-[400px] w-full" />
      ) : states && states.length > 0 ? (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">
              {states.length} state{states.length !== 1 ? 's' : ''}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="rounded-md border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Name</TableHead>
                    <TableHead>Code</TableHead>
                    <TableHead>Region</TableHead>
                    <TableHead className="text-right">Sites</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead className="text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {states.map((state) => (
                    <TableRow key={state.id}>
                      <TableCell className="font-medium">
                        <Link
                          href={`/admin/states/${state.id}`}
                          className="text-primary hover:underline"
                        >
                          {state.name}
                        </Link>
                      </TableCell>
                      <TableCell className="font-mono text-sm">
                        {state.code || '-'}
                      </TableCell>
                      <TableCell className="text-sm text-muted-foreground">
                        {state.region || '-'}
                      </TableCell>
                      <TableCell className="text-right font-mono">
                        {Number(state.sites_count)}
                      </TableCell>
                      <TableCell>
                        <Badge variant={state.is_active ? 'default' : 'secondary'}>
                          {state.is_active ? 'Active' : 'Inactive'}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-right">
                        <div className="flex justify-end gap-1">
                          <Button variant="ghost" size="sm" asChild>
                            <Link href={`/admin/states/${state.id}/edit`}>
                              <Pencil className="h-4 w-4" />
                            </Link>
                          </Button>
                          <AlertDialog>
                            <AlertDialogTrigger asChild>
                              <Button variant="ghost" size="sm" className="text-destructive hover:text-destructive">
                                <Trash2 className="h-4 w-4" />
                              </Button>
                            </AlertDialogTrigger>
                            <AlertDialogContent>
                              <AlertDialogHeader>
                                <AlertDialogTitle>Delete state &quot;{state.name}&quot;?</AlertDialogTitle>
                                <AlertDialogDescription>
                                  This action cannot be undone. States with linked sites cannot be deleted.
                                  {Number(state.sites_count) > 0 && (
                                    <span className="block mt-2 text-destructive font-medium">
                                      This state has {Number(state.sites_count)} linked site(s).
                                      Reassign them first.
                                    </span>
                                  )}
                                </AlertDialogDescription>
                              </AlertDialogHeader>
                              <AlertDialogFooter>
                                <AlertDialogCancel>Cancel</AlertDialogCancel>
                                <AlertDialogAction
                                  onClick={() => handleDelete(state.id, state.name)}
                                  disabled={deleteMutation.isPending}
                                >
                                  Delete
                                </AlertDialogAction>
                              </AlertDialogFooter>
                            </AlertDialogContent>
                          </AlertDialog>
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardContent className="py-12 text-center">
            <Map className="h-10 w-10 mx-auto text-muted-foreground/50 mb-3" />
            <p className="font-medium">No states found</p>
            <p className="text-sm text-muted-foreground mt-1">
              Add a state to start organizing your sites by region.
            </p>
          </CardContent>
        </Card>
      )}
    </div>
  )
}

export default function StatesPage() {
  return (
    <ProtectedRoute requiredRole="admin">
      <StatesPageContent />
    </ProtectedRoute>
  )
}
