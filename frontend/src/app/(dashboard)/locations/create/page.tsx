'use client'

import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { ArrowLeft } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { ProtectedRoute } from '@/components/protected-route'
import { LocationForm } from '@/components/locations/location-form'

export default function CreateLocationPage() {
  const router = useRouter()

  return (
    <ProtectedRoute requiredRole="admin">
      <div className="space-y-6 max-w-2xl">
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="icon" asChild>
            <Link href="/locations">
              <ArrowLeft className="h-5 w-5" />
            </Link>
          </Button>
          <div>
            <h1 className="text-2xl font-bold tracking-tight">Add Site</h1>
            <p className="text-muted-foreground">Create a new site</p>
          </div>
        </div>

        <Card>
          <CardHeader>
            <CardTitle>Site Details</CardTitle>
          </CardHeader>
          <CardContent>
            <LocationForm
              onSuccess={() => router.push('/locations')}
              onCancel={() => router.push('/locations')}
            />
          </CardContent>
        </Card>
      </div>
    </ProtectedRoute>
  )
}
