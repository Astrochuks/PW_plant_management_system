'use client'

import { useRouter, useParams } from 'next/navigation'
import Link from 'next/link'
import { useState } from 'react'
import {
  ArrowLeft,
  Edit2,
  Trash2,
  FolderKanban,
  Calendar,
  Building2,
  MapPin,
  DollarSign,
  FileText,
  CheckCircle,
  XCircle,
  Clock,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Separator } from '@/components/ui/separator'
import { Skeleton } from '@/components/ui/skeleton'
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs'
import { useProject, useDeleteProject } from '@/hooks/use-projects'
import { useAuth } from '@/providers/auth-provider'
import { ProjectMilestoneTimeline } from '@/components/projects/project-milestone-timeline'
import { ProjectLocationLink } from '@/components/projects/project-location-link'
import { toast } from 'sonner'

// ── Status badge config ────────────────────────────────────────────────────
const STATUS_STYLES: Record<string, { label: string; variant: 'default' | 'secondary' | 'destructive' | 'outline'; className?: string }> = {
  active: { label: 'Active', variant: 'default', className: 'bg-emerald-600 hover:bg-emerald-600 text-white' },
  completed: { label: 'Completed', variant: 'secondary', className: 'bg-gray-200 text-gray-700' },
  retention_period: { label: 'Retention Period', variant: 'secondary', className: 'bg-amber-100 text-amber-800' },
  on_hold: { label: 'On Hold', variant: 'outline' },
  cancelled: { label: 'Cancelled', variant: 'destructive' },
}

// ── Helpers ────────────────────────────────────────────────────────────────
function formatCurrency(amount: number): string {
  return new Intl.NumberFormat('en-NG', {
    style: 'currency',
    currency: 'NGN',
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(amount)
}

function formatDate(dateStr: string | null): string {
  if (!dateStr) return '-'
  return new Date(dateStr).toLocaleDateString('en-NG', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  })
}

function CertStatus({ value }: { value: string | null }) {
  if (!value) return <span className="text-muted-foreground">-</span>
  const lower = value.toLowerCase()
  if (lower === 'yes') {
    return (
      <span className="flex items-center gap-1 text-emerald-600">
        <CheckCircle className="h-4 w-4" /> Yes
      </span>
    )
  }
  if (lower === 'no' || lower === 'none') {
    return (
      <span className="flex items-center gap-1 text-muted-foreground">
        <XCircle className="h-4 w-4" /> No
      </span>
    )
  }
  return <span className="text-amber-600">{value}</span>
}

// ── Page ───────────────────────────────────────────────────────────────────
export default function ProjectDetailPage() {
  const params = useParams()
  const projectId = params.id as string
  return <ProjectDetailContent projectId={projectId} />
}

function ProjectDetailContent({ projectId }: { projectId: string }) {
  const router = useRouter()
  const { user } = useAuth()
  const isAdmin = user?.role === 'admin'
  const [activeTab, setActiveTab] = useState('overview')
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false)

  const { data: project, isLoading } = useProject(projectId)
  const deleteMutation = useDeleteProject()

  const handleDelete = async () => {
    try {
      await deleteMutation.mutateAsync(projectId)
      toast.success('Project deleted')
      router.push('/projects')
    } catch {
      toast.error('Failed to delete project')
    }
  }

  if (isLoading) return <DetailSkeleton />

  if (!project) {
    return (
      <div className="text-center py-12">
        <FolderKanban className="h-12 w-12 mx-auto mb-4 text-muted-foreground opacity-50" />
        <p className="text-lg font-medium">Project not found</p>
        <Button variant="outline" className="mt-4" onClick={() => router.push('/projects')}>
          Back to Projects
        </Button>
      </div>
    )
  }

  const statusStyle = STATUS_STYLES[project.status] || STATUS_STYLES.active

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <Button variant="ghost" size="sm" onClick={() => router.back()}>
          <ArrowLeft className="h-4 w-4 mr-2" />
          Projects
        </Button>
        {isAdmin && (
          <div className="flex gap-2">
            <Button variant="outline" size="sm" asChild>
              <Link href={`/projects/${projectId}/edit`}>
                <Edit2 className="h-4 w-4 mr-2" />
                Edit
              </Link>
            </Button>
            <Button
              variant="destructive"
              size="sm"
              onClick={() => setShowDeleteConfirm(true)}
            >
              <Trash2 className="h-4 w-4 mr-2" />
              Delete
            </Button>
          </div>
        )}
      </div>

      {/* Identity */}
      <div className="flex items-start gap-4">
        <div className="p-3 rounded-xl bg-primary/10">
          <FolderKanban className="h-8 w-8 text-primary" />
        </div>
        <div className="flex-1">
          <h1 className="text-2xl font-bold">{project.project_name}</h1>
          <div className="flex items-center gap-2 mt-1">
            <Badge variant={statusStyle.variant} className={statusStyle.className}>
              {statusStyle.label}
            </Badge>
            {project.is_legacy && (
              <Badge variant="outline" className="text-xs text-muted-foreground">
                Legacy
              </Badge>
            )}
            <span className="text-sm text-muted-foreground">{project.client}</span>
            {project.state_name && (
              <span className="text-sm text-muted-foreground">
                &middot; {project.state_name}
              </span>
            )}
          </div>
        </div>
      </div>

      {/* Two-column layout */}
      <div className="grid grid-cols-1 lg:grid-cols-[1fr_320px] gap-6">
        {/* Left: Tabs */}
        <Tabs value={activeTab} onValueChange={setActiveTab}>
          <TabsList variant="line" className="w-full justify-start border-b">
            <TabsTrigger value="overview">Overview</TabsTrigger>
            <TabsTrigger value="timeline">Timeline</TabsTrigger>
            <TabsTrigger value="financials">Financials</TabsTrigger>
          </TabsList>

          {/* OVERVIEW TAB */}
          <TabsContent value="overview" className="space-y-6 pt-4">
            {/* Contract Information */}
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-base">Contract Information</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <InfoItem icon={FolderKanban} label="Project Name" value={project.project_name} />
                  {project.short_name && (
                    <InfoItem icon={FileText} label="Short Name" value={project.short_name} />
                  )}
                  <InfoItem icon={Building2} label="Client" value={project.client} />
                  <InfoItem icon={MapPin} label="State" value={project.state_name} />
                  <InfoItem icon={Calendar} label="Award Date" value={formatDate(project.award_date)} />
                  <InfoItem icon={Calendar} label="Commencement" value={formatDate(project.commencement_date)} />
                  <InfoItem icon={Clock} label="Original Duration" value={project.original_duration_months ? `${project.original_duration_months} months` : null} />
                  <InfoItem icon={Calendar} label="Original Completion" value={formatDate(project.original_completion_date)} />
                  {project.extension_of_time_months && (
                    <InfoItem icon={Clock} label="Extension of Time" value={`${project.extension_of_time_months} months`} />
                  )}
                  {project.revised_completion_date && (
                    <InfoItem icon={Calendar} label="Revised Completion" value={formatDate(project.revised_completion_date)} />
                  )}
                </div>
              </CardContent>
            </Card>

            {/* Certification & Retention */}
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-base">Certification & Retention</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-4">
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                    <div>
                      <p className="text-xs text-muted-foreground mb-1">Award Letter</p>
                      {project.has_award_letter ? (
                        <span className="flex items-center gap-1 text-emerald-600 text-sm">
                          <CheckCircle className="h-4 w-4" /> Yes
                        </span>
                      ) : (
                        <span className="text-muted-foreground text-sm">No</span>
                      )}
                    </div>
                    <div>
                      <p className="text-xs text-muted-foreground mb-1">Substantial Completion</p>
                      <CertStatus value={project.substantial_completion_cert} />
                      {project.substantial_completion_date && (
                        <p className="text-xs text-muted-foreground mt-0.5">{formatDate(project.substantial_completion_date)}</p>
                      )}
                    </div>
                    <div>
                      <p className="text-xs text-muted-foreground mb-1">Final Completion</p>
                      <CertStatus value={project.final_completion_cert} />
                      {project.final_completion_date && (
                        <p className="text-xs text-muted-foreground mt-0.5">{formatDate(project.final_completion_date)}</p>
                      )}
                    </div>
                  </div>
                  <Separator />
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                    <div>
                      <p className="text-xs text-muted-foreground mb-1">Maintenance Cert</p>
                      <CertStatus value={project.maintenance_cert} />
                      {project.maintenance_cert_date && (
                        <p className="text-xs text-muted-foreground mt-0.5">{formatDate(project.maintenance_cert_date)}</p>
                      )}
                    </div>
                    <div>
                      <p className="text-xs text-muted-foreground mb-1">Retention Application</p>
                      <p className="text-sm">{formatDate(project.retention_application_date)}</p>
                    </div>
                    <div>
                      <p className="text-xs text-muted-foreground mb-1">Retention Paid</p>
                      <p className="text-sm">
                        {project.retention_paid || '-'}
                        {project.retention_amount_paid != null && (
                          <span className="text-muted-foreground ml-1">
                            ({formatCurrency(project.retention_amount_paid)})
                          </span>
                        )}
                      </p>
                    </div>
                  </div>
                </div>
              </CardContent>
            </Card>
          </TabsContent>

          {/* FINANCIALS TAB */}
          <TabsContent value="financials" className="space-y-6 pt-4">
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-base">Contract Value</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                  <div>
                    <p className="text-xs text-muted-foreground">Original Contract Sum</p>
                    <p className="text-xl font-bold">
                      {project.original_contract_sum != null
                        ? formatCurrency(project.original_contract_sum)
                        : '-'}
                    </p>
                  </div>
                  <div>
                    <p className="text-xs text-muted-foreground">Variation</p>
                    <p className="text-xl font-bold">
                      {project.variation_sum != null
                        ? formatCurrency(project.variation_sum)
                        : '-'}
                    </p>
                  </div>
                  <div>
                    <p className="text-xs text-muted-foreground">Current Contract Sum</p>
                    <p className="text-xl font-bold text-primary">
                      {project.current_contract_sum != null
                        ? formatCurrency(project.current_contract_sum)
                        : '-'}
                    </p>
                  </div>
                </div>
                {project.contract_sum_raw && (
                  <p className="text-xs text-muted-foreground mt-3">
                    Raw: {project.contract_sum_raw}
                  </p>
                )}
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-base">Financial Tracking</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  <div>
                    <p className="text-xs text-muted-foreground">Works Vetted & Certified</p>
                    <p className="text-lg font-bold">
                      {project.works_vetted_certified != null
                        ? formatCurrency(project.works_vetted_certified)
                        : '-'}
                    </p>
                  </div>
                  <div>
                    <p className="text-xs text-muted-foreground">Payment Received</p>
                    <p className="text-lg font-bold text-emerald-600">
                      {project.payment_received != null
                        ? formatCurrency(project.payment_received)
                        : '-'}
                    </p>
                  </div>
                  <div>
                    <p className="text-xs text-muted-foreground">Outstanding Payment</p>
                    <p className="text-lg font-bold text-amber-600">
                      {project.outstanding_payment != null
                        ? formatCurrency(project.outstanding_payment)
                        : '-'}
                    </p>
                  </div>
                  <div>
                    <p className="text-xs text-muted-foreground">Cost to Date</p>
                    <p className="text-lg font-bold">
                      {project.cost_to_date != null
                        ? formatCurrency(project.cost_to_date)
                        : '-'}
                    </p>
                  </div>
                </div>
              </CardContent>
            </Card>
          </TabsContent>

          {/* TIMELINE TAB */}
          <TabsContent value="timeline" className="pt-4">
            <ProjectMilestoneTimeline projectId={projectId} />
          </TabsContent>
        </Tabs>

        {/* Right: Sidebar */}
        <div className="space-y-4">
          {/* Linked Site */}
          <ProjectLocationLink project={project} />

          {/* Summary Card */}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base flex items-center gap-2">
                <DollarSign className="h-4 w-4" />
                Summary
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div>
                <p className="text-xs text-muted-foreground">Contract Value</p>
                <p className="text-xl font-bold">
                  {project.current_contract_sum != null
                    ? formatCurrency(project.current_contract_sum)
                    : '-'}
                </p>
              </div>
              <Separator />
              <div className="space-y-3">
                <div>
                  <p className="text-xs text-muted-foreground">Client</p>
                  <p className="text-sm font-medium">{project.client}</p>
                </div>
                {project.state_name && (
                  <div>
                    <p className="text-xs text-muted-foreground">State</p>
                    <p className="text-sm font-medium">{project.state_name}</p>
                  </div>
                )}
                <div>
                  <p className="text-xs text-muted-foreground">Award Date</p>
                  <p className="text-sm font-medium">{formatDate(project.award_date)}</p>
                </div>
                {project.source_sheet && (
                  <div>
                    <p className="text-xs text-muted-foreground">Source</p>
                    <p className="text-sm font-medium">{project.source_sheet}</p>
                  </div>
                )}
              </div>
            </CardContent>
          </Card>

          {/* Notes Card */}
          {project.notes && (
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-base flex items-center gap-2">
                  <FileText className="h-4 w-4" />
                  Notes
                </CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-sm text-muted-foreground whitespace-pre-wrap">
                  {project.notes}
                </p>
              </CardContent>
            </Card>
          )}
        </div>
      </div>

      {/* Delete Confirmation Modal */}
      {showDeleteConfirm && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <Card className="w-full max-w-md mx-4">
            <CardContent className="pt-6">
              <h3 className="text-lg font-semibold mb-2">Delete Project</h3>
              <p className="text-sm text-muted-foreground mb-4">
                Are you sure you want to delete &quot;{project.project_name}&quot;?
                This action cannot be undone.
              </p>
              <div className="flex justify-end gap-2">
                <Button variant="outline" onClick={() => setShowDeleteConfirm(false)}>
                  Cancel
                </Button>
                <Button
                  variant="destructive"
                  onClick={handleDelete}
                  disabled={deleteMutation.isPending}
                >
                  {deleteMutation.isPending ? 'Deleting...' : 'Delete'}
                </Button>
              </div>
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  )
}

// ── InfoItem helper ────────────────────────────────────────────────────────
function InfoItem({
  icon: Icon,
  label,
  value,
}: {
  icon: React.ElementType
  label: string
  value: string | null | undefined
}) {
  return (
    <div className="flex items-start gap-3">
      <div className="p-2 rounded-lg bg-muted">
        <Icon className="h-4 w-4 text-muted-foreground" />
      </div>
      <div>
        <p className="text-xs text-muted-foreground">{label}</p>
        <p className="text-sm font-medium">{value || '-'}</p>
      </div>
    </div>
  )
}

// ── Skeleton ───────────────────────────────────────────────────────────────
function DetailSkeleton() {
  return (
    <div className="space-y-6">
      <Skeleton className="h-8 w-32" />
      <div className="flex items-start gap-4">
        <Skeleton className="h-14 w-14 rounded-xl" />
        <div className="space-y-2">
          <Skeleton className="h-7 w-80" />
          <Skeleton className="h-5 w-40" />
        </div>
      </div>
      <Skeleton className="h-[400px] w-full" />
    </div>
  )
}
