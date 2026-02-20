'use client'

import { useState, useEffect } from 'react'
import { useRouter, useParams } from 'next/navigation'
import Link from 'next/link'
import { ArrowLeft, Loader2 } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { Skeleton } from '@/components/ui/skeleton'
import { ProtectedRoute } from '@/components/protected-route'
import { useStateDetail, useUpdateState } from '@/hooks/use-states'
import { getErrorMessage } from '@/lib/api/client'

function EditStateContent() {
  const router = useRouter()
  const params = useParams()
  const stateId = params.id as string

  const { data: state, isLoading } = useStateDetail(stateId)
  const updateMutation = useUpdateState(stateId)

  const [name, setName] = useState('')
  const [code, setCode] = useState('')
  const [region, setRegion] = useState('')
  const [isActive, setIsActive] = useState(true)

  // Populate form when data loads
  useEffect(() => {
    if (state) {
      setName(state.name)
      setCode(state.code || '')
      setRegion(state.region || '')
      setIsActive(state.is_active)
    }
  }, [state])

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()

    if (name.trim().length < 2) {
      toast.error('State name must be at least 2 characters')
      return
    }

    try {
      await updateMutation.mutateAsync({
        name: name.trim(),
        code: code.trim() ? code.trim().toUpperCase() : '',
        region: region.trim() || '',
        is_active: isActive,
      })
      toast.success(`State "${name.trim()}" updated`)
      router.push('/admin/states')
    } catch (error) {
      toast.error(getErrorMessage(error))
    }
  }

  if (isLoading) {
    return (
      <div className="space-y-6 max-w-2xl">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-[300px] w-full" />
      </div>
    )
  }

  if (!state) {
    return (
      <div className="text-center py-12">
        <p className="text-muted-foreground">State not found</p>
      </div>
    )
  }

  return (
    <div className="space-y-6 max-w-2xl">
      {/* Header */}
      <div className="flex items-center gap-3">
        <Link
          href="/admin/states"
          className="p-2 rounded-lg hover:bg-muted transition-colors"
        >
          <ArrowLeft className="h-4 w-4" />
        </Link>
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Edit State</h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            Update {state.name}
          </p>
        </div>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">State Details</CardTitle>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="name">Name *</Label>
              <Input
                id="name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="e.g. Lagos"
                required
                minLength={2}
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="code">Code</Label>
              <Input
                id="code"
                value={code}
                onChange={(e) => setCode(e.target.value)}
                placeholder="e.g. LAG"
                maxLength={10}
              />
              <p className="text-xs text-muted-foreground">
                Short code for the state (max 10 chars, auto-uppercased)
              </p>
            </div>

            <div className="space-y-2">
              <Label htmlFor="region">Region</Label>
              <Input
                id="region"
                value={region}
                onChange={(e) => setRegion(e.target.value)}
                placeholder="e.g. South West"
              />
            </div>

            <div className="flex items-center gap-3">
              <Switch
                id="is-active"
                checked={isActive}
                onCheckedChange={setIsActive}
              />
              <Label htmlFor="is-active">Active</Label>
            </div>

            <div className="flex gap-3 pt-2">
              <Button type="submit" disabled={updateMutation.isPending}>
                {updateMutation.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
                Save Changes
              </Button>
              <Button type="button" variant="outline" onClick={() => router.back()}>
                Cancel
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>
    </div>
  )
}

export default function EditStatePage() {
  return (
    <ProtectedRoute requiredRole="admin">
      <EditStateContent />
    </ProtectedRoute>
  )
}
