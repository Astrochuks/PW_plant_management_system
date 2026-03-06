'use client'

import { useParams, useRouter } from 'next/navigation'
import { ArrowLeft, FolderKanban } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { ProtectedRoute } from '@/components/protected-route'
import { ProjectForm } from '@/components/projects/project-form'
import { useProject } from '@/hooks/use-projects'

export default function EditProjectPage() {
  return (
    <ProtectedRoute requiredRole="admin">
      <EditProjectContent />
    </ProtectedRoute>
  )
}

function EditProjectContent() {
  const params = useParams()
  const router = useRouter()
  const projectId = params.id as string
  const { data: project, isLoading } = useProject(projectId)

  if (isLoading) {
    return (
      <div className="space-y-6">
        <Skeleton className="h-8 w-32" />
        <Skeleton className="h-[600px] w-full max-w-3xl" />
      </div>
    )
  }

  if (!project) {
    return (
      <div className="text-center py-12">
        <p className="text-lg font-medium">Project not found</p>
        <Button variant="outline" className="mt-4" onClick={() => router.push('/projects')}>
          Back to Projects
        </Button>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <Button variant="ghost" size="sm" onClick={() => router.back()}>
          <ArrowLeft className="h-4 w-4 mr-2" />
          Back
        </Button>
      </div>

      <div className="flex items-center gap-3">
        <div className="p-2.5 rounded-xl bg-primary/10">
          <FolderKanban className="h-6 w-6 text-primary" />
        </div>
        <div>
          <h1 className="text-2xl font-bold">Edit Project</h1>
          <p className="text-sm text-muted-foreground">{project.project_name}</p>
        </div>
      </div>

      <ProjectForm mode="edit" project={project} />
    </div>
  )
}
