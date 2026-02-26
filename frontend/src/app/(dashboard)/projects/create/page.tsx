'use client'

import { ArrowLeft, FolderKanban } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { useRouter } from 'next/navigation'
import { ProtectedRoute } from '@/components/protected-route'
import { ProjectForm } from '@/components/projects/project-form'

export default function CreateProjectPage() {
  return (
    <ProtectedRoute requiredRole="admin">
      <CreateProjectContent />
    </ProtectedRoute>
  )
}

function CreateProjectContent() {
  const router = useRouter()

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="sm" onClick={() => router.push('/projects')}>
            <ArrowLeft className="h-4 w-4 mr-2" />
            Projects
          </Button>
        </div>
      </div>

      <div className="flex items-center gap-3">
        <div className="p-2.5 rounded-xl bg-primary/10">
          <FolderKanban className="h-6 w-6 text-primary" />
        </div>
        <h1 className="text-2xl font-bold">Create Project</h1>
      </div>

      <ProjectForm mode="create" />
    </div>
  )
}
