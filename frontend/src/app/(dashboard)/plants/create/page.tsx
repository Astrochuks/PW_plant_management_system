'use client'

import Link from 'next/link'
import { Button } from '@/components/ui/button'
import { ProtectedRoute } from '@/components/protected-route'
import { PlantForm } from '@/components/plants/plant-form'
import { useRouter } from 'next/navigation'
import { ArrowLeft } from 'lucide-react'

function CreatePlantContent() {
  const router = useRouter()

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center gap-2">
        <Button variant="ghost" size="sm" asChild>
          <Link href="/plants">
            <ArrowLeft className="mr-1 h-4 w-4" />
            Back
          </Link>
        </Button>
      </div>

      <div>
        <h1 className="text-3xl font-bold tracking-tight">Create Plant</h1>
        <p className="text-sm text-muted-foreground mt-1">Add a new plant or equipment to the system</p>
      </div>

      {/* Form */}
      <div className="max-w-3xl bg-white dark:bg-slate-950 border border-border rounded-lg p-6">
        <PlantForm
          onSuccess={() => router.push('/plants')}
          onCancel={() => router.push('/plants')}
        />
      </div>
    </div>
  )
}

export default function CreatePlantPage() {
  return (
    <ProtectedRoute requiredRole="admin">
      <CreatePlantContent />
    </ProtectedRoute>
  )
}
