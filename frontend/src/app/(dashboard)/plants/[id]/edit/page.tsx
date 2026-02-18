'use client'

import { useRouter, useParams } from 'next/navigation'
import Link from 'next/link'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { ProtectedRoute } from '@/components/protected-route'
import { PlantForm } from '@/components/plants/plant-form'
import { usePlant } from '@/hooks/use-plants'
import { ArrowLeft } from 'lucide-react'

function EditPlantContent({ plantId }: { plantId: string }) {
  const router = useRouter()
  const { data: plant, isLoading } = usePlant(plantId)

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

  if (!plant) {
    return (
      <div className="space-y-6 text-center">
        <h1 className="text-3xl font-bold">Plant not found</h1>
        <Button asChild>
          <Link href="/plants">Back to Plants</Link>
        </Button>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center gap-2">
        <Button variant="ghost" size="sm" asChild>
          <Link href={`/plants/${plantId}`}>
            <ArrowLeft className="mr-1 h-4 w-4" />
            Back
          </Link>
        </Button>
      </div>

      <div>
        <h1 className="text-3xl font-bold tracking-tight">Edit Plant</h1>
        <p className="text-sm text-muted-foreground mt-1">Update plant information</p>
      </div>

      {/* Form */}
      <div className="max-w-3xl bg-white dark:bg-slate-950 border border-border rounded-lg p-6">
        <PlantForm
          plant={plant}
          onSuccess={() => router.push(`/plants/${plantId}`)}
          onCancel={() => router.push(`/plants/${plantId}`)}
        />
      </div>
    </div>
  )
}

export default function EditPlantPage() {
  const params = useParams()
  const plantId = params.id as string

  return (
    <ProtectedRoute requiredRole="admin">
      <EditPlantContent plantId={plantId} />
    </ProtectedRoute>
  )
}
