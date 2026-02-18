'use client'

import { useParams, useRouter } from 'next/navigation'
import Link from 'next/link'
import { ArrowLeft, MapPin } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { ProtectedRoute } from '@/components/protected-route'
import { LocationForm } from '@/components/locations/location-form'
import { useLocationDetail } from '@/hooks/use-locations'

export default function EditLocationPage() {
  const { id } = useParams<{ id: string }>()
  const router = useRouter()
  const { data: location, isLoading, error } = useLocationDetail(id)

  return (
    <ProtectedRoute requiredRole="admin">
      <div className="space-y-6 max-w-2xl">
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="icon" asChild>
            <Link href={`/locations/${id}`}>
              <ArrowLeft className="h-5 w-5" />
            </Link>
          </Button>
          <div>
            <h1 className="text-2xl font-bold tracking-tight">Edit Site</h1>
            <p className="text-muted-foreground">
              {isLoading ? 'Loading...' : location?.location_name || 'Site not found'}
            </p>
          </div>
        </div>

        {isLoading ? (
          <Card>
            <CardHeader>
              <Skeleton className="h-6 w-32" />
            </CardHeader>
            <CardContent className="space-y-4">
              <Skeleton className="h-10 w-full" />
              <Skeleton className="h-10 w-full" />
              <Skeleton className="h-10 w-32" />
            </CardContent>
          </Card>
        ) : error || !location ? (
          <div className="text-center py-12">
            <MapPin className="h-12 w-12 mx-auto text-muted-foreground/50 mb-4" />
            <h3 className="text-lg font-medium">Site not found</h3>
            <Button variant="outline" className="mt-4" asChild>
              <Link href="/locations">Back to Sites</Link>
            </Button>
          </div>
        ) : (
          <Card>
            <CardHeader>
              <CardTitle>Site Details</CardTitle>
            </CardHeader>
            <CardContent>
              <LocationForm
                location={location}
                onSuccess={() => router.push(`/locations/${id}`)}
                onCancel={() => router.push(`/locations/${id}`)}
              />
            </CardContent>
          </Card>
        )}
      </div>
    </ProtectedRoute>
  )
}
